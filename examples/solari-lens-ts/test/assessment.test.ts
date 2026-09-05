import assert from "node:assert/strict"
import test from "node:test"
import { AssessmentEvidence } from "../src/assessment.js"
import { appendToolResult, desktopHandoffUrl } from "../src/live.js"

test("desktop handoff preserves the Solari preview token", () => {
  const url = desktopHandoffUrl("https://preview.example.test/?pt_token=secret-token&source=fixture", "checkout-17")
  assert.equal(url.pathname, "/payment")
  assert.equal(url.searchParams.get("pt_token"), "secret-token")
  assert.equal(url.searchParams.get("checkout"), "checkout-17")
  assert.equal(url.searchParams.get("environment"), "desktop")
  assert.equal(url.searchParams.get("source"), "fixture")
})

test("assessment requires stage-owned screenshot after the latest successful action", () => {
  const evidence = new AssessmentEvidence()
  const input = { outcome: "blocked", summary: "Payment displayed an error", artifactIds: ["shot"] }
  assert.throws(() => evidence.validate(input), /this stage/)
  evidence.screenshotCaptured("shot")
  assert.throws(() => evidence.validate(input), /latest successful action/)
  evidence.actionSucceeded()
  assert.throws(() => evidence.validate(input), /latest successful action/)
  evidence.screenshotCaptured("after")
  assert.equal(evidence.validate({ ...input, artifactIds: ["after"] }).outcome, "blocked")
  evidence.actionSucceeded()
  assert.throws(() => evidence.validate({ ...input, artifactIds: ["after"] }), /latest successful action/)
  const anotherStage = new AssessmentEvidence()
  assert.throws(() => anotherStage.validate({ ...input, artifactIds: ["after"] }), /this stage/)
})

test("invalid assessments are rejected; insufficient evidence can be inconclusive", () => {
  const evidence = new AssessmentEvidence()
  const input = { outcome: "inconclusive", summary: "No payment result observed", artifactIds: [] }
  assert.deepEqual(evidence.validate(input), input)
  for (const value of [null, [], { ...input, outcome: "confirmed" }, { ...input, summary: " " }, { ...input, summary: "x".repeat(2001) }, { ...input, artifactIds: [42] }, { ...input, cause: "invented" }]) {
    assert.throws(() => evidence.validate(value))
  }
})

test("batched model tool replies precede the latest screenshot message", () => {
  const messages: any[] = [{ role: "assistant", tool_calls: [{ id: "a" }, { id: "b" }, { id: "c" }] }]
  appendToolResult(messages, "a", { artifactId: "first", screenshot: "data:image/png;base64,first" })
  appendToolResult(messages, "b", { ok: true })
  appendToolResult(messages, "c", { artifactId: "last", screenshot: "data:image/png;base64,last" })
  assert.deepEqual(messages.map(message => message.role), ["assistant", "tool", "tool", "tool", "user"])
  assert.deepEqual(messages.slice(1, 4).map(message => message.tool_call_id), ["a", "b", "c"])
  assert.match(messages.at(-1).content[1].image_url.url, /last$/)
  assert.ok(messages.slice(1, 4).every(message => typeof message.content === "string" && !message.content.includes("base64")))
})
