import { startDashboard } from "./dashboard.js"
import { LensStore } from "./lens.js"
import { runLive } from "./live.js"
import { configuredGoKeyAvailable } from "./model.js"

const mode = process.argv[2] ?? "sample"
const port = Number(process.env.LENS_PORT ?? 4173)
const store = new LensStore()

if (mode === "doctor") {
  const checks = [
    ["SOLARI_API_KEY", Boolean(process.env.SOLARI_API_KEY)],
    ["OpenCode Go credentials", Boolean(process.env.OPENCODE_API_KEY || configuredGoKeyAvailable())],
    ["MODEL_NAME", Boolean(process.env.MODEL_NAME || "deepseek-v4-flash-vision-exp")],
    ["OPENCODE_PROTOCOL", (process.env.OPENCODE_PROTOCOL ?? "chat-completions") === "chat-completions"]
  ] as const
  let failed = false
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`)
    if (!ok) failed = true
  }
  console.log("INFO desktop and preview checks run during demo:live to avoid creating billable resources during doctor")
  if (failed) process.exitCode = 1
} else if (mode === "sample") {
  const runId = store.seedSample()
  startDashboard(store, port)
  console.log(`sample run: ${runId}`)
  keepAlive()
} else if (mode === "live") {
  const dashboard = startDashboard(store, port)
  const controller = new AbortController()
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    console.error("Interrupt received; waiting for the current Solari operation to finish cleanup")
    controller.abort()
  }
  process.once("SIGINT", interrupt)
  try {
    const runId = await runLive(store, controller.signal)
    console.log(`live run: ${runId}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", interrupt)
    if (interrupted) {
      await new Promise<void>((resolve) => dashboard.close(() => resolve()))
      process.exitCode = 130
    } else {
      keepAlive()
    }
  }
} else {
  console.error(`Unknown mode ${mode}. Use sample, doctor, or live.`)
  process.exitCode = 1
}

function keepAlive(): void {
  process.on("SIGINT", () => process.exit(0))
}
