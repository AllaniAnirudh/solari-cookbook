import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import { AssessmentEvidence, finishTool, type Assessment } from "./assessment.js"
import { browserAdapter, desktopAdapter, sandboxAdapter, type BrowserAdapter, type DesktopAdapter, type SandboxAdapter } from "./adapters.js"
import { fixtureServerSource, fixtureAnalyzerSource } from "./fixture.js"
import { LensRun, LensStore, type StageStatus } from "./lens.js"
import { browserTools, desktopTools, OpenCodeModel } from "./model.js"

const PORT = 3000
const EXECUTION_TIMEOUT_MS = 5 * 60_000
const CLEANUP_TIMEOUT_MS = 60_000

type BrowserPage = any
type Desktop = any

export async function runLive(store: LensStore, signal: AbortSignal = new AbortController().signal): Promise<string> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(EXECUTION_TIMEOUT_MS)])
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
  let cleanupStatus: "succeeded" | "partial" | "failed" = "partial"
  const stageStatuses: Partial<Record<"browser" | "sandbox" | "desktop", StageStatus>> = {}
  let failure: unknown
  try {
    ensureActive(signal)
    stage("sandbox: create")
    platform = new SolariClient({ apiKey: required("SOLARI_API_KEY") })
    sandbox = await run.executeTool({ environment: "sandbox", tool: "create", input: { template: "base" }, execute: () => platform!.sandboxes.create({ template: "base", timeoutMs: 5 * 60_000 }) })
    await run.executeTool({ environment: "sandbox", tool: "connect", execute: () => sandbox.connect() })
    const sandboxOps = sandboxAdapter(run, {
      command: (command, args) => sandbox.commands.run(command, { args }),
      writeFile: (path, content) => sandbox.files.write(path, content),
      readFile: (path) => sandbox.files.readText(path),
      preview: async (port) => sandbox.previewUrl(port),
      metrics: () => sandbox.metrics()
    })
    await sandboxOps.writeFile("/tmp/lens-fixture/server.py", fixtureServerSource)
    await sandboxOps.writeFile("/tmp/lens-fixture/analyze.py", fixtureAnalyzerSource)
    await sandboxOps.command("start_server", "sh", ["-c", `cd /tmp/lens-fixture && nohup python3 server.py >/tmp/lens-fixture/server.log 2>&1 &`])
    const previewAccess = await sandboxOps.preview(PORT)
    const previewUrl = typeof previewAccess === "string" ? previewAccess : previewAccess.url
    if (!previewUrl) throw new Error("Solari preview did not return a URL")
    if (typeof previewAccess !== "string" && previewAccess.token) {
      const urlToken = new URL(previewUrl).searchParams.get("pt_token")
      if (urlToken && urlToken !== previewAccess.token) throw new Error("Solari preview URL and access token do not match")
    }
    run.artifact({ environment: "sandbox", type: "preview", state: "ready", summary: "Fixture preview URL created and kept secret", metadata: { host: new URL(previewUrl).host } })
    await waitForPreview(previewUrl, signal)
    ensureActive(signal)
    stage("sandbox: preview ready")
    run.event({ operationId: crypto.randomUUID(), environment: "sandbox", provenance: "observed", type: "sandbox.preview.ready", status: "succeeded", summary: "Fixture content is reachable through the Solari preview", attributes: {}, artifactIds: [] })

    browserClient = new Solari({ apiKey: required("SOLARI_API_KEY"), timeoutMs: 20_000, maxAttempts: 1, backoffMs: 0 })
    ensureActive(signal)
    stage("browser: launch")
    browser = await run.executeTool({ environment: "browser", tool: "launch", input: { recording: true }, execute: () => browserClient!.launch({ recording: true }) })
    const page: BrowserPage = await browser.newPage()
    const browserOps = browserAdapter(run, {
      navigate: (url) => page.goto(url),
      readPage: () => page.locator("body").innerText(),
      screenshot: () => page.screenshot({ format: "png" }),
      click: (role, name) => page.getByRole(role, { name }).click({ timeout: 5_000 }),
      type: (label, value) => page.getByLabel(label).fill(value, { timeout: 5_000 })
    })
    const browserUrl = new URL(previewUrl)
    browserUrl.searchParams.set("environment", "browser")
    await browserOps.navigate(browserUrl.toString())
    stage("browser: agent")
    const browserAssessed = await runBrowserAgent(run, model, browserOps, signal)
    const browserStageStatus = browserAssessed ? "succeeded" : "incomplete"
    stageStatuses.browser = browserStageStatus
    run.stage({ environment: "browser", status: browserStageStatus, summary: browserAssessed ? "Browser agent submitted an evidence-linked assessment" : "Browser agent did not submit a verified assessment", evidence: browserAssessed?.artifactIds })
    const browserState = new URL(page.url())
    const checkoutId = browserState.searchParams.get("checkout")
    if (!checkoutId) throw new Error("Browser did not establish a checkout for Desktop confirmation")
    const handoff = desktopHandoffUrl(previewUrl, checkoutId)

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
    await run.executeTool({ environment: "desktop", tool: "open", input: { executable }, execute: () => desktop.open(executable, browserLaunchArgs(executable, handoff.toString())) })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const desktopOps = desktopAdapter(run, {
      screenshot: () => desktop.screenshot({ format: "png" }),
      click: (x, y) => desktop.mouse.click(x, y, { humanize: true }),
      type: (text) => desktop.keyboard.type(text)
    })
    const display = await run.executeTool({ environment: "desktop", tool: "display_size", execute: () => desktop.display.size() })
    const desktopAssessed = await runDesktopConfirmation(run, model, desktopOps, signal, { width: Number(display.w), height: Number(display.h) })
    const desktopStageStatus = desktopAssessed ? "succeeded" : "incomplete"
    stageStatuses.desktop = desktopStageStatus
    run.stage({ environment: "desktop", status: desktopStageStatus, summary: desktopAssessed ? "Desktop agent submitted an evidence-linked assessment" : "Desktop agent did not submit a verified assessment", evidence: desktopAssessed?.artifactIds })

    stage("sandbox: diagnosis")
    const analysis = await runSandboxDiagnosis(run, sandboxOps, store, checkoutId, browserAssessed, desktopAssessed)
    if (sandboxOps.metrics) await sandboxOps.metrics()
    const sandboxStageStatus = analysis.diagnosis === "supported" ? "succeeded" : "incomplete"
    stageStatuses.sandbox = sandboxStageStatus
    run.stage({ environment: "sandbox", status: sandboxStageStatus, summary: `Sandbox evidence analysis is ${analysis.diagnosis}`, evidence: [] })
    diagnosis = analysis.diagnosis
    executionStatus = browserAssessed && desktopAssessed ? "completed" : "incomplete"
    taskOutcome = analysis.checkoutOutcome === "unknown" ? "failed" : analysis.checkoutOutcome
  } catch (error) {
    run.event({ operationId: crypto.randomUUID(), environment: "agent", provenance: "observed", type: "run.error", status: "failed", summary: error instanceof Error ? error.message : String(error), attributes: {}, artifactIds: [] })
    executionStatus = signal.aborted ? "incomplete" : "failed"
    if (signal.aborted) taskOutcome = "failed"
    failure = error
  } finally {
    const cleanup = await cleanupResources(platform, browser, browserClient, desktop, sandbox)
    cleanupStatus = cleanup.status
    for (const environment of cleanup.failedStages) {
      const stageName = environment as "browser" | "sandbox" | "desktop"
      if (stageStatuses[stageName]) stageStatuses[stageName] = "cleanup-pending"
    }
  }
  run.end({ executionStatus, taskOutcome, diagnosis, cleanupStatus, stages: stageStatuses })
  if (failure) throw failure
  return run.runId
}

export function desktopHandoffUrl(previewUrl: string, checkoutId: string): URL {
  const handoff = new URL(previewUrl)
  handoff.pathname = "/payment"
  handoff.searchParams.set("checkout", checkoutId)
  handoff.searchParams.set("environment", "desktop")
  return handoff
}

function stage(message: string): void {
  console.log(`[solari-lens] ${message}`)
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Live run interrupted; cleaning up Solari resources")
}

async function runBrowserAgent(run: LensRun, model: OpenCodeModel, browser: BrowserAdapter, signal: AbortSignal): Promise<Assessment | undefined> {
  const evidence = new AssessmentEvidence()
  const messages: any[] = [{ role: "system", content: "You are investigating a synthetic checkout. Use the tools to observe the page and identify the blocker. Do not invent a cause. Treat a tool error as evidence, do not repeat an impossible action, and stop once you can document the blocker." }, { role: "user", content: "Complete checkout for the test product, or identify and document the blocker." }]
  for (let step = 0; step < 20; step++) {
    ensureActive(signal)
    const response = await model.complete(messages, browserTools, run.runId, signal)
    messages.push({ role: "assistant", content: response.content ?? null, tool_calls: response.tool_calls })
    if (!response.tool_calls?.length) {
      const assessment = await requestFinish(run, model, messages, evidence, "browser", signal)
      if (assessment) return assessment
      messages.push({ role: "user", content: "Submit your assessment using finish with screenshot artifact IDs. Free text is not a verified assessment." })
      continue
    }
    for (const call of response.tool_calls) {
      let result: unknown
      try {
        const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>
        if (call.function.name === "finish") {
          if (response.tool_calls.length !== 1) throw new Error("Call finish alone")
          return recordAssessment(run, "browser", evidence.validate(args))
        }
        if (call.function.name === "observe") {
          const observed = await browser.observe()
          evidence.screenshotCaptured(observed.artifactId)
          result = observed
        } else if (call.function.name === "click") {
          result = await browser.click(String(args.role), String(args.name))
          evidence.actionSucceeded()
        } else if (call.function.name === "type") {
          result = await browser.type(String(args.label), String(args.value))
          evidence.actionSucceeded()
        } else {
          result = { error: `Unsupported tool ${call.function.name}` }
        }
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      appendToolResult(messages, call.id, result)
    }
  }
  return requestFinish(run, model, messages, evidence, "browser", signal)
}

async function runDesktopConfirmation(run: LensRun, model: OpenCodeModel, desktop: DesktopAdapter, signal: AbortSignal, display: { width: number; height: number }): Promise<Assessment | undefined> {
  const evidence = new AssessmentEvidence()
  signal = AbortSignal.any([signal, AbortSignal.timeout(90_000)])
  let guiActions = 0
  const messages: any[] = [{ role: "system", content: "You are independently verifying a synthetic checkout on a 1280x720 desktop. Observe the screen, locate Pay, click it once using absolute screen pixels, then capture the result. If the screen does not change, report the failed interaction. Do not assume the browser agent's diagnosis or infer success from button appearance." }, { role: "user", content: "Attempt this synthetic payment once and document the observed result with a screenshot." }]
  for (let step = 0; step < 10; step++) {
    ensureActive(signal)
    const response = await model.complete(messages, desktopTools, run.runId, signal)
    messages.push({ role: "assistant", content: response.content ?? null, tool_calls: response.tool_calls })
    if (!response.tool_calls?.length) {
      const assessment = await requestFinish(run, model, messages, evidence, "desktop", signal)
      if (assessment) return assessment
      messages.push({ role: "user", content: "Submit your assessment using finish with screenshot artifact IDs. Free text is not a verified assessment." })
      continue
    }
    for (const call of response.tool_calls) {
      let result: unknown
      try {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>
      if (call.function.name === "finish") {
        if (response.tool_calls.length !== 1) throw new Error("Call finish alone")
        return recordAssessment(run, "desktop", evidence.validate(args))
      }
      if (call.function.name === "observe_screen") {
        const observed = await desktop.observe()
        evidence.screenshotCaptured(observed.artifactId)
        result = observed
      } else if (call.function.name === "click") {
        ensureActive(signal)
        if (++guiActions > 10) throw new Error("Desktop GUI action limit reached")
        if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || Number(args.x) < 0 || Number(args.x) >= display.width || Number(args.y) < 0 || Number(args.y) >= display.height) throw new Error(`Desktop click coordinates are outside the ${display.width}x${display.height} display`)
        result = await desktop.click(Number(args.x), Number(args.y))
        evidence.actionSucceeded()
      } else if (call.function.name === "type") {
        ensureActive(signal)
        if (++guiActions > 10) throw new Error("Desktop GUI action limit reached")
        result = await desktop.type(String(args.text))
        evidence.actionSucceeded()
      } else {
        result = { error: `Unsupported tool ${call.function.name}` }
      }
      } catch (error) {
        ensureActive(signal)
        result = { error: error instanceof Error ? error.message : String(error) }
      }
      appendToolResult(messages, call.id, result ?? { ok: true })
    }
  }
  run.event({ operationId: crypto.randomUUID(), environment: "desktop", provenance: "observed", type: "desktop.incomplete", status: "failed", summary: "Desktop confirmation exceeded its action budget", attributes: { limit: 10 }, artifactIds: [] })
  return requestFinish(run, model, messages, evidence, "desktop", signal)
}

async function requestFinish(run: LensRun, model: OpenCodeModel, messages: any[], evidence: AssessmentEvidence, environment: "browser" | "desktop", signal: AbortSignal): Promise<Assessment | undefined> {
  try {
    const response = await model.complete([...messages, { role: "user", content: "Your action budget is over. Return exactly one finish tool call with the best evidence-supported outcome and screenshot artifact IDs. Do not return prose." }], [finishTool], run.runId, signal, { toolChoice: { type: "function", function: { name: "finish" } } })
    const calls = response.tool_calls ?? []
    const call = calls[0]
    if (!call || call.function.name !== "finish" || calls.length !== 1) return undefined
    return recordAssessment(run, environment, evidence.validate(JSON.parse(call.function.arguments || "{}")))
  } catch (error) {
    run.event({ operationId: crypto.randomUUID(), environment, provenance: "observed", type: "agent.assessment.invalid", status: "failed", summary: error instanceof Error ? error.message : String(error), attributes: {}, artifactIds: [] })
    return undefined
  }
}

function recordAssessment(run: LensRun, environment: "browser" | "desktop", assessment: Assessment): Assessment {
  run.event({ operationId: crypto.randomUUID(), environment, provenance: "agent-reported", type: "agent.assessment", status: "succeeded", summary: assessment.summary, attributes: { outcome: assessment.outcome }, artifactIds: assessment.artifactIds })
  return assessment
}

export function appendToolResult(messages: any[], callId: string, result: unknown): void {
  const content = toolResultContent(result)
  // A model can request several tools at once. All tool replies must precede images.
  const last = messages.at(-1)
  const pendingImage = last?.role === "user" && Array.isArray(last.content) && last.content.some((part: any) => part?.type === "image_url")
  messages.splice(pendingImage ? messages.length - 1 : messages.length, 0, { role: "tool", tool_call_id: callId, content: content.text })
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

async function runSandboxDiagnosis(run: LensRun, sandbox: SandboxAdapter, store: LensStore, checkoutId: string, browser: Assessment | undefined, desktop: Assessment | undefined): Promise<{ diagnosis: "supported" | "inconclusive"; checkoutOutcome: "blocked" | "succeeded" | "unknown" }> {
  const logs = await sandbox.readFile("/tmp/lens-fixture/fixture.jsonl")
  const logArtifactId = run.artifact({ environment: "sandbox", type: "fixture-log", state: "ready", summary: "Sanitized checkout request log", content: logs, metadata: { reviewedForSharing: false } })
  const recorded = store.run(run.runId)
  const observations = Object.entries({ browser, desktop }).flatMap(([environment, assessment]) => assessment ? [{ environment, checkoutId, ...assessment }] : [])
  const evidence = JSON.stringify({ runId: run.runId, checkoutId, logArtifactId, artifacts: (recorded?.artifacts ?? []).map((item: any) => ({ id: item.id, environment: item.environment, type: item.type, state: item.state })), observations })
  await sandbox.writeFile("/tmp/lens-fixture/evidence.json", evidence)
  await sandbox.command("diagnose", "python3", ["/tmp/lens-fixture/analyze.py", "/tmp/lens-fixture/fixture.jsonl", "/tmp/lens-fixture/evidence.json", "/tmp/lens-fixture"])
  const diagnosis = await sandbox.readFile("/tmp/lens-fixture/diagnosis.json")
  const report = await sandbox.readFile("/tmp/lens-fixture/report.md")
  const analysis = JSON.parse(diagnosis)
  if (!["supported", "inconclusive"].includes(analysis?.diagnosis) || !["blocked", "succeeded", "unknown"].includes(analysis?.checkoutOutcome)) throw new Error("Analyzer returned an invalid outcome")
  const diagnosisArtifact = run.artifact({ environment: "sandbox", type: "diagnosis", state: "ready", summary: `Evidence diagnosis: ${analysis.diagnosis}`, content: diagnosis, metadata: { reviewedForSharing: false } })
  run.artifact({ environment: "sandbox", type: "report", state: "ready", summary: "Markdown incident report", content: report, metadata: { reviewedForSharing: false, diagnosisArtifact } })
  run.event({ operationId: crypto.randomUUID(), environment: "sandbox", provenance: "derived", type: "sandbox.diagnosis", status: analysis.diagnosis === "supported" ? "succeeded" : "pending", summary: `Request and screenshot evidence analyzed: ${analysis.diagnosis}`, attributes: { diagnosis: analysis.diagnosis }, artifactIds: [diagnosisArtifact] })
  return analysis
}

async function waitForPreview(url: string, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    ensureActive(signal)
    try { const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }); if (response.ok && (await response.text()).includes("Lens Checkout Fixture")) return } catch { ensureActive(signal) }
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

function browserLaunchArgs(executable: string, url: string): string[] {
  const name = executable.toLowerCase().split("/").pop() ?? executable
  if (name.includes("firefox")) return ["--new-instance", "--width", "1280", "--height", "720", url]
  return ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--start-maximized", "--new-window", url]
}

async function cleanupResources(platform: SolariClient | undefined, browser: any, browserClient: Solari | undefined, desktop: Desktop | undefined, sandbox: any): Promise<{ status: "succeeded" | "partial" | "failed"; failedStages: string[] }> {
  const failedStages: string[] = []
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS
  try { if (browser) await withTimeout(() => browser.close(), 10_000, "browser close") } catch { failedStages.push("browser") }
  try { if (browserClient) await withTimeout(() => browserClient.close(), 10_000, "browser client close") } catch { failedStages.push("browser") }
  if (platform && desktop) {
    if (!await releaseAndVerify(() => desktop.kill(), () => platform.desktops.get(desktop.id), deadline)) failedStages.push("desktop")
  }
  if (platform && sandbox) {
    if (!await releaseAndVerify(() => sandbox.kill(), () => platform.sandboxes.get(sandbox.id), deadline)) failedStages.push("sandbox")
  }
  return { status: failedStages.length ? "partial" : "succeeded", failedStages }
}

async function releaseAndVerify(kill: () => Promise<unknown>, get: () => Promise<any>, deadline: number): Promise<boolean> {
  try { await withTimeout(kill, 15_000, "remote release") } catch { /* reconciliation below is authoritative */ }
  while (Date.now() < deadline) {
    try {
      const view = await withTimeout(get, 5_000, "cleanup verification")
      const state = String(view?.status ?? view?.state ?? "")
      if (["gone", "deleted", "destroyed"].includes(state)) return true
    } catch (error) {
      if (/404|not found|gone/i.test(error instanceof Error ? error.message : String(error))) return true
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return false
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs)
    operation().then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
