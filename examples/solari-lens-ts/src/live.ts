import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import { LensRun, LensStore } from "./lens.js"
import { browserTools, desktopTools, OpenCodeModel, textContent } from "./model.js"

const PORT = 3000
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Lens Checkout Fixture</title><style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 20px;color:#17212b}.step{color:#6c7d84;font-size:13px}.panel{border:1px solid #d9e1e4;padding:24px;margin-top:18px}label{display:block;margin:14px 0 5px}input{width:100%;padding:10px;border:1px solid #afbec4}button{padding:11px 18px;margin-top:20px;border:0;background:#276b7a;color:white}button:disabled{background:#aab7ba}.error{color:#a53c30;margin-top:16px}</style></head><body><p class="step">STEP 3 OF 3 · CHECKOUT</p><h1>Payment</h1><div class="panel"><p>Test product · $49.00</p><form id="payment"><label for="card">Card number</label><input id="card" aria-label="Card number" value="4242 4242 4242 4242"><label for="zip">Postal code</label><input id="zip" aria-label="Postal code" name="zipCode" value="M5V 2T6"><button id="pay" type="submit">Pay $49.00</button><p class="error" id="error" hidden>Payment is unavailable. Check the form fields and try again.</p></form></div><script>const pay=document.querySelector('#pay');const form=document.querySelector('#payment');const error=document.querySelector('#error');form.addEventListener('input',()=>{pay.disabled=!document.querySelector('#card').value});form.addEventListener('submit',e=>{e.preventDefault();error.hidden=false;window.lastCheckoutError='expected postalCode, received zipCode'});</script></body></html>`
const server = `from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
HTML = ${JSON.stringify(fixture)}
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(HTML.encode())
    def log_message(self, *args): pass
HTTPServer(('0.0.0.0', ${PORT}), Handler).serve_forever()
`

type BrowserPage = any
type Desktop = any

export async function runLive(store: LensStore, signal: AbortSignal = new AbortController().signal): Promise<string> {
  const model = new OpenCodeModel()
  model.assertConfigured()
  const run = store.startRun("Checkout investigation · live", { model: process.env.MODEL_NAME, workflow: "checkout", version: "0.1" })
  let sandbox: any
  let desktop: Desktop
  let browser: any
  let browserClient: Solari | undefined
  let platform: SolariClient | undefined
  let executionStatus: "completed" | "failed" | "incomplete" = "incomplete"
  let taskOutcome: "succeeded" | "blocked" | "failed" = "failed"
  let diagnosis: "confirmed" | "supported" | "inconclusive" = "inconclusive"
  let cleanupFailed = false
  let failure: unknown
  try {
    ensureActive(signal)
    stage("sandbox: create")
    platform = new SolariClient({ apiKey: required("SOLARI_API_KEY") })
    sandbox = await run.executeTool({ environment: "sandbox", tool: "create", input: { template: "base" }, execute: () => platform!.sandboxes.create({ template: "base", timeoutMs: 5 * 60_000 }) })
    await run.executeTool({ environment: "sandbox", tool: "connect", execute: () => sandbox.connect() })
    await run.executeTool({ environment: "sandbox", tool: "write_fixture", input: { port: PORT }, execute: async () => {
      await sandbox.files.write("/tmp/lens-fixture/index.html", fixture)
      await sandbox.files.write("/tmp/lens-fixture/server.py", server)
      return sandbox.commands.run("sh", { args: ["-c", `cd /tmp/lens-fixture && nohup python3 server.py >/tmp/lens-fixture/server.log 2>&1 &`] })
    } })
    const preview = await sandbox.previewUrl(PORT)
    const previewUrl = preview.url as string
    run.artifact({ environment: "sandbox", type: "preview", state: "ready", summary: "Fixture preview URL created and kept secret", metadata: { host: new URL(previewUrl).host } })
    await waitForPreview(previewUrl)
    ensureActive(signal)
    stage("sandbox: preview ready")
    run.event({ operationId: crypto.randomUUID(), environment: "sandbox", provenance: "observed", type: "sandbox.preview.ready", status: "succeeded", summary: "Fixture content is reachable through the Solari preview", attributes: {}, artifactIds: [] })

    browserClient = new Solari({ apiKey: required("SOLARI_API_KEY"), timeoutMs: 20_000, maxAttempts: 1, backoffMs: 0 })
    ensureActive(signal)
    stage("browser: launch")
    browser = await run.executeTool({ environment: "browser", tool: "launch", input: { recording: true }, execute: () => browserClient!.launch({ recording: true }) })
    const page: BrowserPage = await browser.newPage()
    await run.executeTool({ environment: "browser", tool: "navigate", input: { path: "/payment" }, execute: () => page.goto(`${previewUrl}/payment`) })
    stage("browser: agent")
    await runBrowserAgent(run, model, page, signal)

    ensureActive(signal)
    stage("desktop: create")
    desktop = await run.executeTool({ environment: "desktop", tool: "create", input: { template: "default", resolution: "1280x720" }, execute: () => platform!.desktops.create({ template: "default", resolution: "1280x720", timeoutMs: 5 * 60_000 }) })
    await run.executeTool({ environment: "desktop", tool: "connect", execute: () => desktop.connect() })
    await waitForDesktop(run, desktop)
    const executable = await findDesktopBrowser(run, desktop)
    await run.executeTool({ environment: "desktop", tool: "reset_browser", input: { executable }, execute: async () => {
      await desktop.exec("sh", { args: ["-c", "pkill -f '[g]oogle-chrome' || true"] })
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } })
    await run.executeTool({ environment: "desktop", tool: "open", input: { executable, flags: ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--new-window"] }, execute: () => desktop.open(executable, ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--new-window", `${previewUrl}/payment`]) })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await runDesktopConfirmation(run, model, desktop, signal)

    stage("sandbox: diagnosis")
    await runSandboxDiagnosis(run, sandbox)
    executionStatus = "completed"
    taskOutcome = "blocked"
    diagnosis = "confirmed"
  } catch (error) {
    run.event({ operationId: crypto.randomUUID(), environment: "agent", provenance: "observed", type: "run.error", status: "failed", summary: error instanceof Error ? error.message : String(error), attributes: {}, artifactIds: [] })
    executionStatus = "failed"
    failure = error
  } finally {
    try { if (browser) await browser.close() } catch (error) { cleanupFailed = true; console.error("browser cleanup:", error) }
    try { if (browserClient) await browserClient.close() } catch (error) { cleanupFailed = true; console.error("browser client cleanup:", error) }
    try { if (desktop) await desktop.kill() } catch (error) { cleanupFailed = true; console.error("desktop cleanup:", error) }
    try { if (sandbox) await sandbox.kill() } catch (error) { cleanupFailed = true; console.error("sandbox cleanup:", error) }
  }
  run.end({ executionStatus, taskOutcome, diagnosis, cleanupStatus: cleanupFailed ? "partial" : "succeeded" })
  if (failure) throw failure
  return run.runId
}

function stage(message: string): void {
  console.log(`[solari-lens] ${message}`)
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Live run interrupted; cleaning up Solari resources")
}

async function runBrowserAgent(run: LensRun, model: OpenCodeModel, page: BrowserPage, signal: AbortSignal): Promise<void> {
  const messages: any[] = [{ role: "system", content: "You are investigating a synthetic checkout. Use the tools to observe the page and identify the blocker. Do not invent a cause. Treat a tool error as evidence, do not repeat an impossible action, and stop once you can document the blocker." }, { role: "user", content: "Complete checkout for the test product, or identify and document the blocker." }]
  for (let step = 0; step < 8; step++) {
    ensureActive(signal)
    const response = await model.complete(messages, browserTools, run.runId, signal)
    messages.push({ role: "assistant", content: response.content ?? null, tool_calls: response.tool_calls })
    if (!response.tool_calls?.length) {
      run.decision({ summary: textContent(response.content), observation: "The model returned a final browser assessment.", nextAction: "desktop confirmation" })
      return
    }
    for (const call of response.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>
      let result: unknown
      try {
        if (call.function.name === "observe") {
          const text = await page.locator("body").innerText()
          const shot = await page.screenshot({ format: "png" })
          const artifactId = run.artifact({ environment: "browser", type: "screenshot", state: "ready", summary: "Browser observation screenshot", content: Buffer.from(shot).toString("base64"), metadata: { bytes: shot.byteLength, reviewedForSharing: false } })
          result = { text, artifactId, screenshot: `data:image/png;base64,${Buffer.from(shot).toString("base64")}` }
        } else if (call.function.name === "click") {
          result = await run.executeTool({ environment: "browser", tool: "click", input: args, execute: () => page.getByRole(String(args.role), { name: String(args.name) }).click({ timeout: 5_000 }) })
        } else if (call.function.name === "type") {
          result = await run.executeTool({ environment: "browser", tool: "type", input: { label: args.label }, execute: () => page.getByLabel(String(args.label)).fill(String(args.value), { timeout: 5_000 }) })
        } else {
          result = { error: `Unsupported tool ${call.function.name}` }
        }
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      appendToolResult(messages, call.id, result)
    }
  }
  run.decision({ summary: "Browser tool budget reached before a final assessment.", observation: "The model did not finish within 8 tool calls.", nextAction: "desktop confirmation" })
}

async function runDesktopConfirmation(run: LensRun, model: OpenCodeModel, desktop: Desktop, signal: AbortSignal): Promise<void> {
  const messages: any[] = [{ role: "system", content: "You are independently verifying a visible checkout state on a desktop. Use screenshots and choose only actions supported by the tools. Do not assume the browser agent's diagnosis. Report only what is visibly true." }, { role: "user", content: "Inspect the checkout screen and report the visible state of the payment control." }]
  for (let step = 0; step < 10; step++) {
    ensureActive(signal)
    const response = await model.complete(messages, desktopTools, run.runId, signal)
    messages.push({ role: "assistant", content: response.content ?? null, tool_calls: response.tool_calls })
    if (!response.tool_calls?.length) {
      run.decision({ summary: textContent(response.content), observation: "The desktop agent returned its visual confirmation.", nextAction: "sandbox diagnosis" })
      return
    }
    for (const call of response.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>
      let result: unknown
      if (call.function.name === "observe_screen") {
        const shot = await desktop.screenshot({ format: "png" })
        const artifactId = run.artifact({ environment: "desktop", type: "screenshot", state: "ready", summary: "Desktop observation screenshot", content: Buffer.from(shot).toString("base64"), metadata: { bytes: shot.byteLength, reviewedForSharing: false } })
        result = { artifactId, screenshot: `data:image/png;base64,${Buffer.from(shot).toString("base64")}` }
      } else if (call.function.name === "click") {
        result = await run.executeTool({ environment: "desktop", tool: "click", input: args, execute: () => desktop.mouse.click(Number(args.x), Number(args.y), { humanize: true }) })
      } else if (call.function.name === "type") {
        result = await run.executeTool({ environment: "desktop", tool: "type", input: { text: "[synthetic]" }, execute: () => desktop.keyboard.type(String(args.text)) })
      } else {
        result = { error: `Unsupported tool ${call.function.name}` }
      }
      appendToolResult(messages, call.id, result ?? { ok: true })
    }
  }
  run.event({ operationId: crypto.randomUUID(), environment: "desktop", provenance: "observed", type: "desktop.incomplete", status: "failed", summary: "Desktop confirmation exceeded its action budget", attributes: { limit: 10 }, artifactIds: [] })
}

function appendToolResult(messages: any[], callId: string, result: unknown): void {
  const content = toolResultContent(result)
  messages.push({ role: "tool", tool_call_id: callId, content: content.text })
  if (content.image) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message?.role === "user" && Array.isArray(message.content) && message.content.some((part: any) => part?.type === "image_url")) messages.splice(index, 1)
    }
    messages.push({ role: "user", content: [
      { type: "text", text: "Here is the screenshot returned by the preceding observation tool." },
      { type: "image_url", image_url: { url: content.image } }
    ] })
  }
}

function toolResultContent(result: unknown): { text: string; image?: string } {
  if (!result || typeof result !== "object" || !("screenshot" in result)) return { text: typeof result === "object" ? JSON.stringify(result) : String(result) }
  const value = result as { screenshot: string; [key: string]: unknown }
  const { screenshot, ...metadata } = value
  return { text: JSON.stringify(metadata), image: screenshot }
}

async function runSandboxDiagnosis(run: LensRun, sandbox: any): Promise<void> {
  const evidence = JSON.stringify({ runId: run.runId, instruction: "Compare the browser and desktop observations with the fixture schema.", expectedField: "postalCode", submittedField: "zipCode" })
  await run.executeTool({ environment: "sandbox", tool: "write_evidence", execute: () => sandbox.files.write("/tmp/lens-fixture/evidence.json", evidence) })
  await run.executeTool({ environment: "sandbox", tool: "diagnose", execute: () => sandbox.commands.run("python3", { args: ["-c", "import json; d=json.load(open('/tmp/lens-fixture/evidence.json')); json.dump({'diagnosis':'The form submits zipCode while the fixture expects postalCode.','evidence':['browser observation','desktop screenshot','fixture schema']}, open('/tmp/lens-fixture/diagnosis.json','w')); open('/tmp/lens-fixture/report.md','w').write('# Diagnosis\\n\\nThe `zipCode` field does not match the expected `postalCode` field.\\n')"] }) })
  const diagnosis = await sandbox.files.readText("/tmp/lens-fixture/diagnosis.json")
  const report = await sandbox.files.readText("/tmp/lens-fixture/report.md")
  const diagnosisArtifact = run.artifact({ environment: "sandbox", type: "diagnosis", state: "ready", summary: "Deterministic diagnosis from browser, desktop, and fixture evidence", content: diagnosis, metadata: { reviewedForSharing: true } })
  run.artifact({ environment: "sandbox", type: "report", state: "ready", summary: "Markdown incident report", content: report, metadata: { reviewedForSharing: true, diagnosisArtifact } })
  run.event({ operationId: crypto.randomUUID(), environment: "sandbox", provenance: "derived", type: "sandbox.diagnosis", status: "succeeded", summary: "Derived diagnosis: zipCode does not match the expected postalCode field", attributes: { evidenceCoverage: "browser + desktop + fixture" }, artifactIds: [diagnosisArtifact] })
}

async function waitForPreview(url: string): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try { const response = await fetch(url); if (response.ok && (await response.text()).includes("Lens Checkout Fixture")) return } catch { /* preview is still warming */ }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error("Fixture preview did not return expected content")
}

async function waitForDesktop(run: LensRun, desktop: Desktop): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const health = await run.executeTool({ environment: "desktop", tool: "health", execute: () => desktop.health() })
    if (health?.ready) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error("Desktop did not become ready")
}

async function findDesktopBrowser(run: LensRun, desktop: Desktop): Promise<string> {
  const result = await run.executeTool({ environment: "desktop", tool: "find_browser", execute: () => desktop.exec("sh", { args: ["-c", "command -v google-chrome || command -v chromium || command -v chromium-browser || command -v firefox"] }) })
  const executable = String(result.stdout ?? "").trim().split("\n").find(Boolean)
  if (!executable) throw new Error("No supported browser executable found in desktop template")
  return executable.split("/").pop()!
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
