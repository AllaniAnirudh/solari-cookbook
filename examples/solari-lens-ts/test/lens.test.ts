import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Lens, LensStore, redact } from "../src/lens.js"

function store(): LensStore {
  return new LensStore(join(mkdtempSync(join(tmpdir(), "solari-lens-test-")), "lens.db"))
}

test("events have monotonic sequences and preserve operation errors", async () => {
  const lens = store()
  const run = lens.startRun("test", { authorization: "Bearer secret" })
  await assert.rejects(() => run.executeTool({ environment: "sandbox", tool: "fail", input: { token: "secret" }, execute: () => { throw new Error("expected failure") } }), /expected failure/)
  const data = lens.run(run.runId)!
  assert.equal((data.run as any).metadata.authorization, "[REDACTED]")
  assert.equal((data.events as any[]).at(-1).status, "failed")
  assert.match(JSON.stringify(data.events), /\[REDACTED\]/)
  assert.equal((data.events as any[]).map((event) => event.sequence).join(","), "1,2,3")
})

test("tool results summarize opaque SDK handles without persisting the handle", async () => {
  const lens = store()
  const run = lens.startRun("opaque result")
  const handle = Object.create({ close() {} })
  await run.executeTool({ environment: "browser", tool: "launch", execute: () => handle })
  const event = lens.run(run.runId)?.events.find((item: any) => item.type === "browser.tool.complete") as any
  assert.deepEqual(event.attributes.result, { kind: "Object" })
})

test("sample run is credential-free and has all three environment stages", () => {
  const lens = store()
  const runId = lens.seedSample()
  const data = lens.run(runId)!
  const environments = new Set((data.events as any[]).map((event) => event.environment))
  assert.deepEqual([...environments].sort(), ["agent", "browser", "desktop", "sandbox"])
  assert.equal((data.artifacts as any[]).some((artifact) => artifact.state === "ready"), true)
  assert.match(JSON.stringify(data), /postalCode/)
})

test("persistence failure cannot prevent a tool or replace its result or exception", async () => {
  const lens = new LensStore(":memory:")
  const run = lens.startRun("storage outage")
  lens.db.close()
  const handle = { close() {}, marker: Symbol("owned resource") }
  let calls = 0
  const actual = await run.executeTool({ environment: "browser", tool: "launch", execute: () => { calls++; return handle } })
  assert.equal(calls, 1)
  assert.equal(actual, handle)
  const original = new Error("remote failure")
  await assert.rejects(run.executeTool({ environment: "desktop", tool: "click", execute: () => { throw original } }), error => error === original)
  assert.equal(run.recordingFailures, 4)
})

test("result serialization failure preserves resource ownership", async () => {
  const lens = new LensStore(":memory:")
  const run = lens.startRun("opaque provider result")
  const result = Object.defineProperty({}, "unsafe", { enumerable: true, get() { throw new Error("do not inspect") } })
  assert.equal(await run.executeTool({ environment: "browser", tool: "launch", execute: () => result }), result)
  assert.equal(run.recordingFailures, 1)
  lens.db.close()
})

test("credentials are removed from persisted summaries and text artifacts", () => {
  const lens = new LensStore(":memory:")
  const run = lens.startRun("redaction")
  const secret = "Bearer private-value"
  const url = "https://preview.example/?pt_token=private-token"
  run.decision({ summary: `Failure: ${secret} ${url}` })
  run.artifact({ environment: "sandbox", type: "report", state: "ready", summary: secret, content: `${secret}\n${url}`, metadata: { authorization: secret } })
  const data = JSON.stringify(lens.run(run.runId))
  assert.doesNotMatch(data, /private-value|private-token/)
  assert.match(data, /REDACTED/)
  lens.db.close()
})

test("public Lens facade creates a project-scoped run and validates owned evidence", () => {
  const lens = new Lens({ projectId: "agent-debugging", storage: "local", filename: ":memory:" })
  const run = lens.startRun({ name: "generic task", attributes: { model: "test-model" } })
  const artifactId = run.artifact({ environment: "browser", type: "text", state: "ready", summary: "Visible observation", content: "Observed state", contentType: "text/plain" })
  const operation = (lens.store.run(run.runId)?.events as any[]).find(event => event.type === "artifact.available")
  run.step({ environment: "browser", type: "browser.observe", summary: "Observed page", artifactIds: [artifactId] })
  run.decision({ summary: "Continue from observed state", evidence: [{ operationId: operation.operationId, artifactId }] })
  assert.equal((lens.store.run(run.runId)?.run as any).metadata.project, "agent-debugging")
  assert.throws(() => run.decision({ summary: "foreign evidence", evidence: [{ operationId: operation.operationId, artifactId: "missing" }] }), /not owned/)
  lens.close()
})

test("redaction handles cycles and throwing getters", () => {
  const value: Record<string, unknown> = { token: "secret" }
  value.self = value
  Object.defineProperty(value, "unstable", { enumerable: true, get() { throw new Error("unavailable") } })
  assert.deepEqual(redact(value), { token: "[REDACTED]", self: "[CYCLE]", unstable: "[UNAVAILABLE]" })
})

test("a reopened store marks an interrupted run incomplete", () => {
  const directory = mkdtempSync(join(tmpdir(), "solari-lens-recovery-"))
  const filename = join(directory, "lens.db")
  const first = new LensStore(filename)
  const run = first.startRun("interrupted")
  first.db.prepare("UPDATE events SET received_timestamp = ? WHERE run_id = ?").run(new Date(Date.now() - 10 * 60_000).toISOString(), run.runId)
  first.db.close()
  const reopened = new LensStore(filename)
  try {
    const recovered = reopened.run(run.runId)!
    assert.equal((recovered.run as any).status, "incomplete")
    assert.equal((recovered.run as any).outcome.cleanupStatus, "partial")
    assert.equal((recovered.events as any[]).at(-1).type, "run.recovered")
  } finally { reopened.db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test("terminal run outcomes cannot be overwritten or ended twice", () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("terminal state")
  run.end({ executionStatus: "completed", taskOutcome: "succeeded", diagnosis: "supported", cleanupStatus: "succeeded" })
  const before = store.run(run.runId)!
  store.endRun(run.runId, { executionStatus: "failed", taskOutcome: "failed", diagnosis: "inconclusive", cleanupStatus: "partial" })
  const after = store.run(run.runId)!
  assert.deepEqual(after.run, before.run)
  assert.equal((after.events as any[]).filter(event => event.type === "run.ended").length, 1)
  store.db.close()
})
