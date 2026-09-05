import test from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixtureServerSource, fixtureAnalyzerSource } from "../src/fixture.js"

for (const defective of [true, false]) {
  test(`checkout HTTP flow and evidence analysis: defect=${defective}`, { timeout: 15_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "lens-fixture-"))
    const log = join(directory, "fixture.jsonl")
    const child = spawn("python3", ["-u", "-c", fixtureServerSource], { env: { ...process.env, PORT: "0", HOST: "127.0.0.1", CHECKOUT_DEFECT: defective ? "1" : "0", FIXTURE_LOG: log }, stdio: ["ignore", "pipe", "pipe"] })
    const lines = createInterface({ input: child.stdout })
    const exit = once(child, "exit")
    try {
      const [line] = await once(lines, "line")
      const base = `http://127.0.0.1:${JSON.parse(line).port}`
      const post = (path: string, fields: Record<string, string>) => fetch(base + path, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) })
      assert.match(await (await fetch(base)).text(), /Field Notebook/)
      const cart = await post("/cart?environment=browser", { productId: "notebook" })
      assert.equal(cart.status, 303)
      const cartUrl = cart.headers.get("location")!
      const checkoutId = new URL(cartUrl, base).searchParams.get("checkout")!
      const query = `?checkout=${checkoutId}&environment=browser`
      assert.match(await (await fetch(base + cartUrl)).text(), /Continue to shipping/)
      assert.match(await (await fetch(base + "/shipping" + query)).text(), /Street address/)
      const shipping = { name: "Test Person", address: "1 Test Street", city: "Toronto", postalCode: "M5V 2T6" }
      const shipped = await post("/shipping" + query, shipping)
      const paymentPath = shipped.headers.get("location")!
      const html = await (await fetch(base + paymentPath)).text()
      assert.match(html, /Pay \$49.00/)
      assert.match(html, defective ? /name="zipCode"/ : /name="postalCode"/)
      const payload: Record<string, string> = { ...shipping, paymentToken: "test-card" }
      if (defective) { payload.zipCode = payload.postalCode; delete payload.postalCode }
      for (const environment of ["browser", "desktop"]) {
        const response = await post(`/payment?checkout=${checkoutId}&environment=${environment}`, payload)
        assert.equal(response.status, defective ? 422 : 303)
        if (defective) assert.match(await response.text(), /Something went wrong/)
        else assert.match(await (await fetch(base + response.headers.get("location"))).text(), /Order confirmed/)
      }
      const logs = readFileSync(log, "utf8")
      assert.doesNotMatch(logs, /Test Person|1 Test Street|M5V 2T6|test-card/)
      const evidence = {
        checkoutId, logArtifactId: "log-1",
        artifacts: [ { id: "log-1", environment: "sandbox", type: "fixture-log", state: "ready" }, ...["browser", "desktop"].map(environment => ({ id: environment + "-shot", environment, type: "screenshot", state: "ready" })) ],
        observations: ["browser", "desktop"].map(environment => ({ environment, checkoutId, outcome: defective ? "blocked" : "succeeded", artifactIds: [environment + "-shot"] }))
      }
      const path = join(directory, "evidence.json")
      const analyze = () => JSON.parse(execFileSync("python3", ["-c", fixtureAnalyzerSource, log, path, directory], { encoding: "utf8" }))
      writeFileSync(path, JSON.stringify(evidence))
      assert.equal(analyze().diagnosis, "supported")
      for (const mutate of [
        (value: typeof evidence) => { value.observations[1].artifactIds = ["browser-shot"] },
        (value: typeof evidence) => { value.observations[1].checkoutId = "another-checkout" },
        (value: typeof evidence) => { value.observations[1].outcome = defective ? "succeeded" : "blocked" },
        (value: typeof evidence) => { value.artifacts[2].state = "pending" },
        (value: typeof evidence) => { value.logArtifactId = "unknown-log" }
      ]) {
        const invalid = structuredClone(evidence)
        mutate(invalid)
        writeFileSync(path, JSON.stringify(invalid))
        assert.equal(analyze().diagnosis, "inconclusive")
      }
      evidence.observations.pop()
      writeFileSync(path, JSON.stringify(evidence))
      assert.equal(analyze().diagnosis, "inconclusive")
      assert.match(readFileSync(join(directory, "report.md"), "utf8"), /desktop/)
    } finally {
      child.kill("SIGTERM")
      await exit
      lines.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
