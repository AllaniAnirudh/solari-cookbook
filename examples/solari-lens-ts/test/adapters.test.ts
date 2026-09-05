import assert from "node:assert/strict"
import test from "node:test"
import { browserAdapter, desktopAdapter, sandboxAdapter } from "../src/adapters.js"
import { LensStore } from "../src/lens.js"

test("browser adapter records actions and turns screenshots into run-owned evidence", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("browser adapter")
  const browser = browserAdapter(run, {
    navigate: async () => undefined,
    readPage: async () => "Visible page",
    screenshot: async () => new Uint8Array([137, 80, 78, 71]),
    click: async () => undefined,
    type: async () => undefined
  })
  try {
    await browser.navigate("https://example.test/?pt_token=hidden")
    const observation = await browser.observe()
    await browser.click("button", "Continue")
    assert.equal(store.artifact(observation.artifactId)?.environment, "browser")
    assert.ok(store.run(run.runId)?.events.some((event: any) => event.type === "browser.tool.complete"))
  } finally { store.db.close() }
})

test("sandbox adapter maps a nonzero command to an operation failure", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("sandbox adapter")
  const sandbox = sandboxAdapter(run, {
    command: async () => ({ exitCode: 17, stdout: "out", stderr: "err" }),
    writeFile: async () => undefined,
    readFile: async () => "",
    preview: async () => "https://example.test/"
  })
  try {
    await assert.rejects(() => sandbox.command("diagnose", "sh", ["-c", "exit 17"]), /17/)
    assert.equal((store.run(run.runId)?.events as any[]).filter(event => event.type === "sandbox.tool.error").length, 1)
  } finally { store.db.close() }
})

test("desktop adapter records screenshot evidence and GUI input", async () => {
  const store = new LensStore(":memory:")
  const run = store.startRun("desktop adapter")
  const calls: string[] = []
  const desktop = desktopAdapter(run, {
    screenshot: async () => new Uint8Array([1, 2, 3]),
    click: async () => { calls.push("click") },
    type: async () => { calls.push("type") }
  })
  try {
    const observation = await desktop.observe()
    await desktop.click(10, 20)
    await desktop.type("synthetic")
    assert.equal(store.artifact(observation.artifactId)?.environment, "desktop")
    assert.deepEqual(calls, ["click", "type"])
  } finally { store.db.close() }
})
