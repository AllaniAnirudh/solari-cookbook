import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LensStore } from "../src/lens.js"

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

test("sample run is credential-free and has all three environment stages", () => {
  const lens = store()
  const runId = lens.seedSample()
  const data = lens.run(runId)!
  const environments = new Set((data.events as any[]).map((event) => event.environment))
  assert.deepEqual([...environments].sort(), ["agent", "browser", "desktop", "sandbox"])
  assert.equal((data.artifacts as any[]).some((artifact) => artifact.state === "ready"), true)
  assert.match(JSON.stringify(data), /postalCode/)
})
