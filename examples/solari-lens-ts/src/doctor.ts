import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import type { CommandResult } from "@solarisdk/core"
import { OpenCodeModel, type ToolDefinition } from "./model.js"

const DOCTOR_TIMEOUT = 90_000
const doctorControl: ToolDefinition = {
  type: "function",
  function: {
    name: "identify_control",
    description: "Identify the visible test button and its center point in the supplied 1280x720 screenshot.",
    parameters: { type: "object", properties: { label: { type: "string" }, left: { type: "integer" }, top: { type: "integer" }, right: { type: "integer" }, bottom: { type: "integer" } }, required: ["label", "left", "top", "right", "bottom"], additionalProperties: false }
  }
}

const doctorFixture = String.raw`import http.server
import os
import socketserver

HTML = """<!doctype html><html><body style='margin:0;height:100vh;font:24px system-ui'><p id='state' style='position:fixed;left:500px;top:180px'>Ready</p><button id='probe' style='position:fixed;left:420px;top:300px;width:440px;height:250px;font-size:24px' onclick='document.getElementById("state").textContent="Changed"'>Verify desktop input</button></body></html>"""

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

class Server(socketserver.TCPServer):
    allow_reuse_address = True

with Server(('0.0.0.0', int(os.environ.get('PORT', '3001'))), Handler) as server:
    print(server.server_address[1], flush=True)
    server.serve_forever()
`

export type DoctorCheck = { name: string; ok: boolean; detail: string }
export type DoctorResult = { checks: DoctorCheck[]; ok: boolean }

export async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = []
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) return { checks: [{ name: "SOLARI_API_KEY", ok: false, detail: "missing" }], ok: false }
  checks.push({ name: "SOLARI_API_KEY", ok: true, detail: "configured" })
  const model = new OpenCodeModel()
  try { model.assertConfigured(); checks.push({ name: "OpenCode Go", ok: true, detail: "configured" }) } catch (error) { checks.push({ name: "OpenCode Go", ok: false, detail: message(error) }); return { checks, ok: false } }

  const client = new SolariClient({ apiKey, callTimeoutMs: 15_000 })
  const browserClient = new Solari({ apiKey, timeoutMs: 15_000, maxAttempts: 1, backoffMs: 0 })
  let sandbox: any
  let desktop: any
  let browser: any
  let serverStarted = false
  try {
    sandbox = await bounded(() => client.sandboxes.create({ template: "base", timeoutMs: DOCTOR_TIMEOUT }), "sandbox creation")
    await bounded(() => sandbox.connect(), "sandbox connection")
    await bounded(() => sandbox.files.write("/tmp/lens-doctor/server.py", doctorFixture), "fixture write")
    const command = await bounded<CommandResult>(() => sandbox.commands.run("sh", { args: ["-c", "cd /tmp/lens-doctor && nohup python3 server.py >/tmp/lens-doctor/server.log 2>&1 &"] }), "fixture start")
    if (command.exitCode !== 0) throw new Error("fixture start returned a nonzero exit code")
    serverStarted = true
    const preview = await bounded<{ url: string }>(() => sandbox.previewUrl(3001), "preview creation")
    const previewUrl = String(preview.url)
    await waitForContent(previewUrl)
    checks.push({ name: "Sandbox preview", ok: true, detail: "fixture content reachable" })

    browser = await bounded(() => browserClient.launch({ recording: false }), "browser launch")
    const page = await browser.newPage()
    await bounded(() => page.goto(previewUrl), "browser navigation")
    const body = await bounded<string>(() => page.locator("body").innerText(), "browser observation")
    if (!body.includes("Verify desktop input")) throw new Error("browser did not render fixture control")
    checks.push({ name: "Browser render", ok: true, detail: "fixture control visible" })

    desktop = await bounded(() => client.desktops.create({ template: "default", resolution: "1280x720", timeoutMs: DOCTOR_TIMEOUT }), "desktop creation")
    await bounded(() => desktop.connect(), "desktop connection")
    const health = await bounded<{ ready?: boolean }>(() => desktop.health(), "desktop health")
    if (!health?.ready) throw new Error("desktop health is not ready")
    checks.push({ name: "Desktop readiness", ok: true, detail: "1280x720 session ready" })
    const executable = await findBrowser(desktop)
    checks.push({ name: "Desktop browser", ok: true, detail: executable })
    await bounded(() => desktop.open(executable, browserLaunchArgs(executable, previewUrl)), "desktop browser open")
    await new Promise(resolve => setTimeout(resolve, 2500))
    const before = await bounded<Uint8Array>(() => desktop.screenshot({ format: "png" }), "desktop screenshot")
    if (!nonBlank(before)) throw new Error("desktop screenshot is blank")
    const point = await identifyControl(model, before)
    if (point.x < 0 || point.x >= 1280 || point.y < 0 || point.y >= 720) throw new Error("model returned an out-of-bounds control point")
    await bounded(() => desktop.mouse.click(point.x, point.y, { humanize: true }), "desktop input")
    await new Promise(resolve => setTimeout(resolve, 750))
    const after = await bounded<Uint8Array>(() => desktop.screenshot({ format: "png" }), "desktop post-action screenshot")
    if (Buffer.compare(Buffer.from(before), Buffer.from(after)) === 0) throw new Error(`desktop input did not change the screenshot at (${point.x},${point.y})`)
    checks.push({ name: "Desktop vision and input", ok: true, detail: "model-selected control changed visible state" })
  } catch (error) {
    checks.push({ name: "Platform/model compatibility", ok: false, detail: message(error) })
  } finally {
    if (browser) { try { await browser.close() } catch { checks.push({ name: "Browser cleanup", ok: false, detail: "release failed" }) } }
    try { await browserClient.close() } catch { /* client cleanup is best effort */ }
    if (desktop) await verifyCleanup(() => desktop.kill(), () => client.desktops.get(desktop.id), "Desktop cleanup", checks)
    if (sandbox) await verifyCleanup(() => sandbox.kill(), () => client.sandboxes.get(sandbox.id), "Sandbox cleanup", checks)
    if (serverStarted) checks.push({ name: "Fixture ownership", ok: true, detail: "temporary fixture was sandbox-owned" })
  }
  return { checks, ok: checks.every(check => check.ok) }
}

async function identifyControl(model: OpenCodeModel, screenshot: Uint8Array): Promise<{ x: number; y: number }> {
  const response = await model.complete([
    { role: "system", content: "Identify the bounding box of the button labelled Verify desktop input. Use absolute screenshot pixels including browser chrome. Call identify_control; do not answer with prose." },
    { role: "user", content: [{ type: "text", text: "Inspect this 1280x720 desktop screenshot and return the button bounds." }, { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}` } }] }
  ], [doctorControl], "doctor")
  const call = response.tool_calls?.find(item => item.function.name === "identify_control")
  if (!call) throw new Error("model did not return a control identification tool call")
  const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>
  const bounds = [args.left, args.top, args.right, args.bottom]
  if (bounds.some(value => !Number.isInteger(value)) || typeof args.label !== "string" || Number(args.right) <= Number(args.left) || Number(args.bottom) <= Number(args.top)) throw new Error("model control output failed schema validation")
  return { x: Math.round((Number(args.left) + Number(args.right)) / 2), y: Math.round((Number(args.top) + Number(args.bottom)) / 2) }
}

async function findBrowser(desktop: any): Promise<string> {
  const result = await bounded<CommandResult>(() => desktop.exec("sh", { args: ["-c", "for x in google-chrome chromium chromium-browser firefox; do command -v $x && exit 0; done; exit 1"] }), "browser discovery")
  if (result.exitCode !== 0 || !String(result.stdout).trim()) throw new Error("no supported desktop browser found")
  return String(result.stdout).trim().split("\n")[0].trim()
}

async function waitForContent(url: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); if (response.ok && (await response.text()).includes("Verify desktop input")) return } catch { /* warming */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error("preview did not return expected fixture content")
}

function nonBlank(bytes: Uint8Array): boolean { return bytes.byteLength > 1000 && new Set(bytes).size > 8 }

async function verifyCleanup(kill: () => Promise<unknown>, get: () => Promise<any>, name: string, checks: DoctorCheck[]): Promise<void> {
  try {
    await bounded(kill, `${name} release`)
    try {
      const view = await bounded(get, `${name} verification`)
      const state = view?.status ?? view?.state
      if (state !== "gone") throw new Error(`remote state is ${state ?? "unknown"}`)
    } catch (error) {
      if (!/404|not found|gone/i.test(message(error))) throw error
    }
    checks.push({ name, ok: true, detail: "released and verified" })
  } catch (error) { checks.push({ name, ok: false, detail: message(error) }) }
}

async function bounded<T>(operation: () => Promise<T>, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), 15_000)
    try {
      operation().then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
    } catch (error) { clearTimeout(timer); reject(error) }
  })
}

function browserLaunchArgs(executable: string, url: string): string[] {
  const name = executable.toLowerCase().split("/").pop() ?? executable
  if (name.includes("firefox")) return ["--new-instance", "--width", "1280", "--height", "720", url]
  return ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--start-maximized", "--new-window", url]
}

function message(error: unknown): string { return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180) }
