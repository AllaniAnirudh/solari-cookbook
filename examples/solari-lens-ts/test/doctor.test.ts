import assert from "node:assert/strict"
import test from "node:test"
import { runDoctor } from "../src/doctor.js"

test("doctor stops before creating resources when Solari credentials are absent", async () => {
  const previous = process.env.SOLARI_API_KEY
  delete process.env.SOLARI_API_KEY
  try {
    const result = await runDoctor()
    assert.equal(result.ok, false)
    assert.deepEqual(result.checks, [{ name: "SOLARI_API_KEY", ok: false, detail: "missing" }])
  } finally {
    if (previous === undefined) delete process.env.SOLARI_API_KEY
    else process.env.SOLARI_API_KEY = previous
  }
})
