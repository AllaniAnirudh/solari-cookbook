import test from "node:test"
import assert from "node:assert/strict"
import { LensStore } from "../src/lens.js"
import { exportMarkdown, exportRun } from "../src/export.js"

test("export excludes unreviewed pixels while preserving evidence references", () => {
  const store = new LensStore(":memory:")
  try {
    const run = store.startRun("export")
    const id = run.artifact({ environment: "desktop", type: "screenshot", state: "ready", summary: "private capture", content: "PRIVATE_PIXELS", metadata: { reviewedForSharing: false } })
    run.artifact({ environment: "sandbox", type: "report", state: "ready", summary: "reviewed", content: "public report", metadata: { reviewedForSharing: true } })
    const output = exportRun(store, run.runId)!
    assert.doesNotMatch(output, /PRIVATE_PIXELS/)
    assert.match(output, /public report/)
    const records = output.trim().split("\n").map(line => JSON.parse(line))
    assert.ok(records.some(record => record.recordType === "event" && record.artifactIds.includes(id)))
    assert.ok(records.some(record => record.id === id && record.contentOmitted))
    assert.equal(exportRun(store, "missing"), undefined)
    const markdown = exportMarkdown(store, run.runId)!
    assert.match(markdown, /## Run story/)
    assert.match(markdown, /content omitted: not reviewed for sharing/)
    assert.equal(exportMarkdown(store, "missing"), undefined)
  } finally { store.db.close() }
})
