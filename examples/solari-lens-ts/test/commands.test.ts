import test from "node:test"
import assert from "node:assert/strict"
import { LensStore } from "../src/lens.js"
import { CommandFailure, executeCommand } from "../src/commands.js"

test("a resolved command with a nonzero exit is recorded as failed", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("command failure")
  const result = { exitCode: 7, stdout: "partial output", stderr: "fixture failed" }
  try {
    await assert.rejects(executeCommand(run, { environment: "sandbox", tool: "diagnose", execute: async () => result }), error => error instanceof CommandFailure && error.result === result)
    const events = store.run(run.runId)!.events as Array<{ type: string; status: string }>
    assert.equal(events.at(-1)!.status, "failed")
    assert.equal(events.some(event => event.type === "sandbox.tool.complete"), false)
    const success = { exitCode: 0, stdout: "ok", stderr: "" }
    assert.equal(await executeCommand(run, { environment: "sandbox", tool: "command", execute: async () => success }), success)
  } finally { store.db.close() }
})

test("command output is bounded and marked when truncated", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("bounded output")
  try {
    const result = await executeCommand(run, { environment: "sandbox", tool: "verbose", execute: async () => ({ exitCode: 0, stdout: "x".repeat(70_000), stderr: "é".repeat(70_000) }) })
    assert.ok(result.stdoutTruncated)
    assert.ok(result.stderrTruncated)
    assert.ok(Buffer.byteLength(result.stdout) <= 64 * 1024)
    assert.ok(Buffer.byteLength(result.stderr) <= 64 * 1024)
    assert.match(result.stdout, /output truncated/)
  } finally { store.db.close() }
})
