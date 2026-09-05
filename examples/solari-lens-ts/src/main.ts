import { startDashboard } from "./dashboard.js"
import { LensStore } from "./lens.js"
import { runLive } from "./live.js"
import { runDoctor } from "./doctor.js"

const mode = process.argv[2] ?? "sample"
const port = Number(process.env.LENS_PORT ?? 4173)
const store = new LensStore()

if (mode === "doctor") {
  const result = await runDoctor()
  for (const check of result.checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`)
  if (!result.ok) process.exitCode = 1
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
      dashboard.closeAllConnections()
      await new Promise<void>((resolve) => dashboard.close(() => resolve()))
      process.exitCode = 130
    } else if (process.env.LENS_RUN_ONCE === "1") {
      dashboard.closeAllConnections()
      await new Promise<void>((resolve) => dashboard.close(() => resolve()))
      store.db.close()
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
