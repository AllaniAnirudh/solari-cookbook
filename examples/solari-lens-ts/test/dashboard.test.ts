import test from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { startDashboard } from "../src/dashboard.js"
import { LensStore } from "../src/lens.js"

test("SSE resumes from Last-Event-ID and delivers newly appended events", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("stream test")
  const server = startDashboard(store, 0)
  await once(server, "listening")
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  const controller = new AbortController()
  try {
    assert.equal((await fetch(`${base}/events/missing`)).status, 404)
    assert.equal((await fetch(`${base}/events/${run.runId}?after=NaN`)).status, 400)
    const response = await fetch(`${base}/events/${run.runId}?after=0`, { headers: { "Last-Event-ID": "1" }, signal: controller.signal })
    const reader = response.body!.getReader()
    run.decision({ summary: "new observation" })
    const chunk = await reader.read()
    const data = new TextDecoder().decode(chunk.value)
    assert.match(data, /id: 2\ndata:/)
    assert.doesNotMatch(data, /id: 1\n/)
    assert.match(data, /new observation/)
    await reader.cancel()
  } finally {
    controller.abort()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.db.close()
  }
})

test("dashboard is task-agnostic and exposes run summary signals", async () => {
  const store = new LensStore(":memory:")
  store.seedSample()
  const server = startDashboard(store, 0)
  await once(server, "listening")
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  try {
    const page = await (await fetch(base)).text()
    assert.match(page, /Run inspector/)
    assert.doesNotMatch(page, />Checkout</)
    const summaries = await (await fetch(`${base}/api/runs`)).json() as any[]
    assert.deepEqual(summaries[0].environments, ["sandbox", "browser", "desktop"])
    assert.equal(summaries[0].artifactCount, 2)
    assert.equal(summaries[0].decisionCount, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.db.close()
  }
})

test("artifact review is explicit before export", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("review")
  const artifactId = run.artifact({ environment: "browser", type: "screenshot", state: "ready", summary: "capture", content: "PIXELS", metadata: { reviewedForSharing: false } })
  const server = startDashboard(store, 0)
  await once(server, "listening")
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  try {
    assert.equal((await fetch(`${base}/api/artifacts/${artifactId}/review`, { method: "POST" })).status, 204)
    assert.equal(store.artifact(artifactId)?.metadata.reviewedForSharing, true)
    assert.equal((await fetch(`${base}/api/artifacts/missing/review`, { method: "POST" })).status, 404)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.db.close()
  }
})
