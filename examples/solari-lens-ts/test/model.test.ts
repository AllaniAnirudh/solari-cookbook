import assert from "node:assert/strict"
import test from "node:test"
import { OpenCodeModel } from "../src/model.js"

test("forced finish requests function tool choice instead of allowing another action", async () => {
  const previousKey = process.env.OPENCODE_API_KEY
  const previousFetch = globalThis.fetch
  let payload: any
  process.env.OPENCODE_API_KEY = "test-model-key"
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "finish-1", function: { name: "finish", arguments: "{}" } }] } }] }), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  try {
    await new OpenCodeModel().complete([], [], "test-run", undefined, { toolChoice: { type: "function", function: { name: "finish" } } })
    assert.deepEqual(payload.tool_choice, { type: "function", function: { name: "finish" } })
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.OPENCODE_API_KEY
    else process.env.OPENCODE_API_KEY = previousKey
  }
})
