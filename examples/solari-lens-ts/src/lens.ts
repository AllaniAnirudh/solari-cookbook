import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

export type Environment = "agent" | "browser" | "sandbox" | "desktop"
export type Provenance = "observed" | "agent-reported" | "derived" | "operator"
export type EventStatus = "started" | "succeeded" | "failed" | "pending" | "unsupported"

export type LensEvent = {
  id: string
  sequence: number
  runId: string
  operationId: string
  parentOperationId?: string
  sourceTimestamp: string
  receivedTimestamp: string
  environment: Environment
  provenance: Provenance
  type: string
  status: EventStatus
  summary: string
  attributes: Record<string, unknown>
  artifactIds: string[]
}

export type RunOutcome = {
  executionStatus: "completed" | "failed" | "incomplete"
  taskOutcome: "succeeded" | "blocked" | "failed"
  diagnosis: "confirmed" | "supported" | "inconclusive"
  cleanupStatus: "succeeded" | "partial" | "failed"
}

const secretKey = /(authorization|cookie|token|secret|password|api[_-]?key|streamurl|previewurl|signed)/i
const secretValue = /(?:Bearer\s+)?(?:slr_live_[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]+|https?:\/\/[^\s]+(?:token|signature)[^\s]+)/gi

function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(secretValue, "[REDACTED]")
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(item)]))
  }
  return value
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export class LensRun {
  constructor(private readonly store: LensStore, readonly runId: string) {}

  event(input: Omit<LensEvent, "id" | "sequence" | "runId" | "sourceTimestamp" | "receivedTimestamp">): LensEvent {
    return this.store.append({ ...input, runId: this.runId })
  }

  async executeTool<T>(input: {
    environment: Environment
    tool: string
    input?: unknown
    execute: () => Promise<T> | T
    parentOperationId?: string
  }): Promise<T> {
    const operationId = id("op")
    this.event({
      operationId,
      parentOperationId: input.parentOperationId,
      environment: input.environment,
      provenance: "observed",
      type: `${input.environment}.tool.start`,
      status: "started",
      summary: `${input.environment}: ${input.tool}`,
      attributes: { tool: input.tool, input: redact(input.input) },
      artifactIds: []
    })
    try {
      const result = await input.execute()
      this.event({
        operationId,
        parentOperationId: input.parentOperationId,
        environment: input.environment,
        provenance: "observed",
        type: `${input.environment}.tool.complete`,
        status: "succeeded",
        summary: `${input.tool} completed`,
        attributes: { tool: input.tool, result: redact(summarize(result)) },
        artifactIds: []
      })
      return result
    } catch (error) {
      this.event({
        operationId,
        parentOperationId: input.parentOperationId,
        environment: input.environment,
        provenance: "observed",
        type: `${input.environment}.tool.error`,
        status: "failed",
        summary: `${input.tool} failed`,
        attributes: { tool: input.tool, error: error instanceof Error ? error.message : String(error) },
        artifactIds: []
      })
      throw error
    }
  }

  decision(input: { summary: string; observation?: string; nextAction?: string; evidence?: Array<{ operationId: string; artifactId: string }> }): LensEvent {
    return this.event({
      operationId: id("decision"),
      environment: "agent",
      provenance: "agent-reported",
      type: "agent.decision",
      status: "succeeded",
      summary: input.summary,
      attributes: redact({ observation: input.observation, nextAction: input.nextAction }) as Record<string, unknown>,
      artifactIds: input.evidence?.map((item) => item.artifactId) ?? []
    })
  }

  artifact(input: { environment: Environment; type: string; state: string; summary: string; content?: string; metadata?: Record<string, unknown> }): string {
    const artifactId = id("artifact")
    this.store.saveArtifact({ artifactId, runId: this.runId, ...input, metadata: redact(input.metadata ?? {}) })
    this.event({
      operationId: id("artifact-op"),
      environment: input.environment,
      provenance: input.environment === "agent" ? "agent-reported" : "observed",
      type: "artifact.available",
      status: input.state === "ready" ? "succeeded" : "pending",
      summary: input.summary,
      attributes: redact({ artifactType: input.type, state: input.state, metadata: input.metadata }) as Record<string, unknown>,
      artifactIds: [artifactId]
    })
    return artifactId
  }

  end(outcome: RunOutcome): void {
    this.store.endRun(this.runId, outcome)
  }
}

export class LensStore {
  readonly db: DatabaseSync

  constructor(filename = process.env.LENS_DB ?? ".lens-data/lens.db") {
    mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, metadata TEXT NOT NULL,
        outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL,
        run_id TEXT NOT NULL, operation_id TEXT NOT NULL, parent_operation_id TEXT,
        source_timestamp TEXT NOT NULL, received_timestamp TEXT NOT NULL,
        environment TEXT NOT NULL, provenance TEXT NOT NULL, type TEXT NOT NULL,
        status TEXT NOT NULL, summary TEXT NOT NULL, attributes TEXT NOT NULL,
        artifact_ids TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, environment TEXT NOT NULL,
        type TEXT NOT NULL, state TEXT NOT NULL, summary TEXT NOT NULL,
        content TEXT, metadata TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
  }

  startRun(name: string, metadata: Record<string, unknown> = {}): LensRun {
    const runId = id("run")
    this.db.prepare("INSERT INTO runs (id, name, status, started_at, metadata) VALUES (?, ?, 'running', ?, ?)").run(runId, name, new Date().toISOString(), JSON.stringify(redact(metadata)))
    const run = new LensRun(this, runId)
    run.event({ operationId: id("run-op"), environment: "agent", provenance: "operator", type: "run.started", status: "started", summary: name, attributes: redact(metadata) as Record<string, unknown>, artifactIds: [] })
    return run
  }

  append(input: Omit<LensEvent, "id" | "sequence" | "sourceTimestamp" | "receivedTimestamp">): LensEvent {
    const event: LensEvent = {
      ...input,
      id: id("event"),
      sequence: 0,
      sourceTimestamp: new Date().toISOString(),
      receivedTimestamp: new Date().toISOString(),
      attributes: redact(input.attributes) as Record<string, unknown>,
      artifactIds: [...input.artifactIds]
    }
    const current = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events").get() as { sequence: number }
    event.sequence = Number(current.sequence) + 1
    this.db.prepare(`INSERT INTO events (id, sequence, run_id, operation_id, parent_operation_id, source_timestamp, received_timestamp, environment, provenance, type, status, summary, attributes, artifact_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.id, event.sequence, event.runId, event.operationId, event.parentOperationId ?? null, event.sourceTimestamp, event.receivedTimestamp, event.environment, event.provenance, event.type, event.status, event.summary, JSON.stringify(event.attributes), JSON.stringify(event.artifactIds))
    return event
  }

  saveArtifact(input: { artifactId: string; runId: string; environment: Environment; type: string; state: string; summary: string; content?: string; metadata: unknown }): void {
    this.db.prepare("INSERT INTO artifacts (id, run_id, environment, type, state, summary, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.artifactId, input.runId, input.environment, input.type, input.state, input.summary, input.content ?? null, JSON.stringify(input.metadata), new Date().toISOString())
  }

  endRun(runId: string, outcome: RunOutcome): void {
    this.db.prepare("UPDATE runs SET status = ?, ended_at = ?, outcome = ? WHERE id = ?").run(outcome.executionStatus, new Date().toISOString(), JSON.stringify(outcome), runId)
    this.append({ runId, operationId: id("run-end"), environment: "agent", provenance: "operator", type: "run.ended", status: outcome.executionStatus === "completed" ? "succeeded" : "failed", summary: `Investigation ${outcome.executionStatus}`, attributes: outcome, artifactIds: [] })
  }

  runs(): unknown[] {
    return this.db.prepare("SELECT id, name, status, started_at as startedAt, ended_at as endedAt, metadata, outcome FROM runs ORDER BY started_at DESC").all().map(parseRow)
  }

  run(runId: string): { run: unknown; events: unknown[]; artifacts: unknown[] } | undefined {
    const run = this.db.prepare("SELECT id, name, status, started_at as startedAt, ended_at as endedAt, metadata, outcome FROM runs WHERE id = ?").get(runId)
    if (!run) return undefined
    const events = this.db.prepare("SELECT id, sequence, run_id as runId, operation_id as operationId, parent_operation_id as parentOperationId, source_timestamp as sourceTimestamp, received_timestamp as receivedTimestamp, environment, provenance, type, status, summary, attributes, artifact_ids as artifactIds FROM events WHERE run_id = ? ORDER BY sequence").all(runId).map(parseRow)
    const artifacts = this.db.prepare("SELECT id, run_id as runId, environment, type, state, summary, content, metadata, created_at as createdAt FROM artifacts WHERE run_id = ? ORDER BY created_at").all(runId).map(parseRow)
    return { run: parseRow(run), events, artifacts }
  }

  artifact(artifactId: string): any | undefined {
    const row = this.db.prepare("SELECT id, run_id as runId, environment, type, state, summary, content, metadata, created_at as createdAt FROM artifacts WHERE id = ?").get(artifactId)
    return row ? parseRow(row) : undefined
  }

  seedSample(): string {
    const existing = this.db.prepare("SELECT id FROM runs WHERE id = 'sample-run'").get()
    if (existing) return "sample-run"
    this.db.prepare("INSERT INTO runs (id, name, status, started_at, ended_at, metadata, outcome) VALUES ('sample-run', 'Checkout investigation · sample', 'completed', datetime('now', '-1 minute'), datetime('now'), ?, ?)").run(JSON.stringify({ model: "sample-data", workflow: "checkout" }), JSON.stringify({ executionStatus: "completed", taskOutcome: "blocked", diagnosis: "confirmed", cleanupStatus: "succeeded" }))
    const run = new LensRun(this, "sample-run")
    const add = (environment: Environment, provenance: Provenance, type: string, summary: string, attributes: Record<string, unknown> = {}) => run.event({ operationId: id("sample-op"), environment, provenance, type, status: "succeeded", summary, attributes, artifactIds: [] })
    add("agent", "operator", "run.started", "Complete checkout or identify and document the blocker")
    add("sandbox", "observed", "sandbox.preview.ready", "Fixture preview is reachable from Solari")
    add("browser", "observed", "browser.navigate", "Opened the checkout fixture")
    add("browser", "observed", "browser.observe", "Payment control is disabled after address submission", { visible: "Payment unavailable" })
    const screenshot = "sample-browser-screenshot"
    this.saveArtifact({ artifactId: screenshot, runId: "sample-run", environment: "browser", type: "screenshot", state: "ready", summary: "Synthetic checkout screenshot", content: "synthetic-screenshot", metadata: { reviewedForSharing: true } })
    add("agent", "agent-reported", "agent.decision", "The visible state is blocked; inspect fixture evidence before retrying", { observation: "Payment control disabled", nextAction: "inspect sandbox evidence" })
    add("desktop", "observed", "desktop.screenshot", "Desktop independently confirms the blocked payment state", { actions: 3 })
    this.saveArtifact({ artifactId: "sample-diagnosis", runId: "sample-run", environment: "sandbox", type: "report", state: "ready", summary: "Schema mismatch diagnosis", content: "Derived diagnosis: the form submits zipCode while the fixture expects postalCode.", metadata: { reviewedForSharing: true } })
    add("sandbox", "derived", "sandbox.diagnosis", "Derived diagnosis: zipCode does not match the expected postalCode field", { evidenceCoverage: "3/3" })
    add("agent", "operator", "run.ended", "Investigation succeeded; checkout blocked; cleanup succeeded")
    this.db.prepare("UPDATE events SET artifact_ids = ? WHERE run_id = 'sample-run' AND type = 'browser.observe'").run(JSON.stringify([screenshot]))
    return "sample-run"
  }
}

function parseRow(row: any): any {
  for (const key of ["metadata", "outcome", "attributes", "artifactIds"]) {
    if (typeof row[key] === "string") {
      try { row[key] = JSON.parse(row[key]) } catch { /* keep malformed provider data visible */ }
    }
  }
  return row
}

function summarize(value: unknown): unknown {
  if (value instanceof Uint8Array) return { kind: "bytes", length: value.byteLength }
  if (typeof value === "string" && value.length > 1000) return `${value.slice(0, 1000)}…`
  return value
}
