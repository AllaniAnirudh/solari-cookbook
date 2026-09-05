import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"

export type Environment = "agent" | "browser" | "sandbox" | "desktop"
export type Provenance = "observed" | "agent-reported" | "derived" | "operator"
export type EventStatus = "started" | "succeeded" | "failed" | "pending" | "unsupported"
export type Stage = "browser" | "sandbox" | "desktop"
export type StageStatus = "succeeded" | "failed" | "unsupported" | "cleanup-pending" | "incomplete"
export type ArtifactState = "pending" | "ready" | "capture-failed" | "invalid" | "expired" | "unsupported"

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
  stages?: Partial<Record<Stage, StageStatus>>
}

export type LensOptions = {
  projectId: string
  storage?: "local"
  filename?: string
  tracer?: unknown
}

const secretKey = /(authorization|cookie|token|secret|password|api[_-]?key|streamurl|previewurl|signed)/i
const secretValue = /Bearer\s+[^\s"'<>]+|slr_live_[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]+|https?:\/\/[^\s"'<>]*(?:token|signature)[^\s"'<>]*/gi
const RECOVERY_STALE_MS = 5 * 60_000

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.replace(secretValue, "[REDACTED]")
  if (Array.isArray(value)) return value.map((item) => redact(item, seen))
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CYCLE]"
    seen.add(value)
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (secretKey.test(key)) { output[key] = "[REDACTED]"; continue }
      try { output[key] = redact((value as Record<string, unknown>)[key], seen) } catch { output[key] = "[UNAVAILABLE]" }
    }
    return output
  }
  return value
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export class LensRun {
  recordingFailures = 0
  constructor(private readonly store: LensStore, readonly runId: string) {}

  private recordToolEvent(record: () => void): void {
    try { record() } catch { this.recordingFailures++ }
  }

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
    this.recordToolEvent(() => this.event({
      operationId,
      parentOperationId: input.parentOperationId,
      environment: input.environment,
      provenance: "observed",
      type: `${input.environment}.tool.start`,
      status: "started",
      summary: `${input.environment}: ${input.tool}`,
      attributes: { tool: input.tool, input: redact(input.input) },
      artifactIds: []
    }))
    try {
      const result = await input.execute()
      this.recordToolEvent(() => this.event({
        operationId,
        parentOperationId: input.parentOperationId,
        environment: input.environment,
        provenance: "observed",
        type: `${input.environment}.tool.complete`,
        status: "succeeded",
        summary: `${input.tool} completed`,
        attributes: { tool: input.tool, result: redact(summarize(result)) },
        artifactIds: []
      }))
      return result
    } catch (error) {
      this.recordToolEvent(() => this.event({
        operationId,
        parentOperationId: input.parentOperationId,
        environment: input.environment,
        provenance: "observed",
        type: `${input.environment}.tool.error`,
        status: "failed",
        summary: `${input.tool} failed`,
        attributes: { tool: input.tool, error: error instanceof Error ? error.message : String(error) },
        artifactIds: []
      }))
      throw error
    }
  }

  decision(input: { summary: string; observation?: string; nextAction?: string; evidence?: Array<{ operationId: string; artifactId: string }> }): LensEvent {
    for (const evidence of input.evidence ?? []) this.store.assertEvidence(this.runId, evidence)
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

  step(input: { environment: Environment; type: string; summary: string; status?: EventStatus; attributes?: Record<string, unknown>; artifactIds?: string[] }): LensEvent {
    for (const artifactId of input.artifactIds ?? []) this.store.assertArtifact(this.runId, artifactId)
    return this.event({
      operationId: id("step"),
      environment: input.environment,
      provenance: "observed",
      type: input.type,
      status: input.status ?? "succeeded",
      summary: input.summary,
      attributes: input.attributes ?? {},
      artifactIds: input.artifactIds ?? []
    })
  }

  stage(input: { environment: Stage; status: StageStatus; summary: string; evidence?: string[] }): LensEvent {
    for (const artifactId of input.evidence ?? []) this.store.assertArtifact(this.runId, artifactId)
    return this.event({
      operationId: id("stage"),
      environment: input.environment,
      provenance: "operator",
      type: "stage.status",
      status: input.status === "succeeded" ? "succeeded" : input.status === "unsupported" ? "unsupported" : input.status === "incomplete" || input.status === "cleanup-pending" ? "pending" : "failed",
      summary: input.summary,
      attributes: { stageStatus: input.status },
      artifactIds: input.evidence ?? []
    })
  }

  artifact(input: { environment: Environment; type: string; state: ArtifactState; summary: string; content?: string; contentType?: string; metadata?: Record<string, unknown> }): string {
    const artifactId = id("artifact")
    const producerOperationId = id("artifact-op")
    this.store.saveArtifact({ artifactId, runId: this.runId, ...input, producerOperationId, metadata: redact(input.metadata ?? {}) })
    this.event({
      operationId: producerOperationId,
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

export class Lens {
  readonly store: LensStore
  readonly projectId: string

  constructor(options: LensOptions) {
    if (!options.projectId.trim()) throw new Error("projectId is required")
    if (options.storage && options.storage !== "local") throw new Error("Only local Lens storage is supported in this prototype")
    this.projectId = options.projectId
    this.store = new LensStore(options.filename)
  }

  startRun(input: { name: string; attributes?: Record<string, unknown> }): LensRun {
    return this.store.startRun(input.name, { project: this.projectId, ...(input.attributes ?? {}) })
  }

  close(): void { this.store.db.close() }
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
        content TEXT, metadata TEXT NOT NULL, created_at TEXT NOT NULL,
        producer_operation_id TEXT, content_type TEXT, sha256 TEXT
      );
    `)
    this.addArtifactColumn("producer_operation_id", "TEXT")
    this.addArtifactColumn("content_type", "TEXT")
    this.addArtifactColumn("sha256", "TEXT")
    this.recoverOrphanedRuns()
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
      summary: redact(input.summary) as string,
      attributes: redact(input.attributes) as Record<string, unknown>,
      artifactIds: [...input.artifactIds]
    }
    const current = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events").get() as { sequence: number }
    event.sequence = Number(current.sequence) + 1
    this.db.prepare(`INSERT INTO events (id, sequence, run_id, operation_id, parent_operation_id, source_timestamp, received_timestamp, environment, provenance, type, status, summary, attributes, artifact_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.id, event.sequence, event.runId, event.operationId, event.parentOperationId ?? null, event.sourceTimestamp, event.receivedTimestamp, event.environment, event.provenance, event.type, event.status, event.summary, JSON.stringify(event.attributes), JSON.stringify(event.artifactIds))
    return event
  }

  saveArtifact(input: { artifactId: string; runId: string; environment: Environment; type: string; state: ArtifactState; summary: string; content?: string; contentType?: string; producerOperationId?: string; metadata: unknown }): void {
    const content = input.type === "screenshot" ? input.content : redact(input.content)
    const sha256 = content == null ? null : createHash("sha256").update(String(content)).digest("hex")
    this.db.prepare("INSERT INTO artifacts (id, run_id, environment, type, state, summary, content, metadata, created_at, producer_operation_id, content_type, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.artifactId, input.runId, input.environment, input.type, input.state, redact(input.summary) as string, content as string ?? null, JSON.stringify(redact(input.metadata)), new Date().toISOString(), input.producerOperationId ?? null, input.contentType ?? (input.type === "screenshot" ? "image/png" : "text/plain"), sha256)
  }

  private addArtifactColumn(name: string, type: string): void {
    const columns = this.db.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>
    if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type}`)
  }

  private recoverOrphanedRuns(): void {
    const cutoff = new Date(Date.now() - RECOVERY_STALE_MS).toISOString()
    const orphaned = this.db.prepare("SELECT runs.id FROM runs LEFT JOIN (SELECT run_id, MAX(received_timestamp) AS last_seen FROM events GROUP BY run_id) latest ON latest.run_id = runs.id WHERE runs.status = 'running' AND COALESCE(latest.last_seen, runs.started_at) < ?").all(cutoff) as Array<{ id: string }>
    for (const row of orphaned) {
      const outcome: RunOutcome = { executionStatus: "incomplete", taskOutcome: "failed", diagnosis: "inconclusive", cleanupStatus: "partial" }
      this.db.prepare("UPDATE runs SET status = 'incomplete', ended_at = ?, outcome = ? WHERE id = ? AND status = 'running'").run(new Date().toISOString(), JSON.stringify(outcome), row.id)
      this.append({ runId: row.id, operationId: id("recovery"), environment: "agent", provenance: "operator", type: "run.recovered", status: "pending", summary: "Recovered an interrupted run; resource cleanup could not be confirmed", attributes: outcome, artifactIds: [] })
    }
  }

  endRun(runId: string, outcome: RunOutcome): void {
    const result = this.db.prepare("UPDATE runs SET status = ?, ended_at = ?, outcome = ? WHERE id = ? AND status = 'running'").run(outcome.executionStatus, new Date().toISOString(), JSON.stringify(outcome), runId)
    if (Number(result.changes) !== 1) return
    this.append({ runId, operationId: id("run-end"), environment: "agent", provenance: "operator", type: "run.ended", status: outcome.executionStatus === "completed" ? "succeeded" : outcome.executionStatus === "incomplete" ? "pending" : "failed", summary: `Investigation ${outcome.executionStatus}`, attributes: outcome, artifactIds: [] })
  }

  runs(): unknown[] {
    return this.db.prepare("SELECT id, name, status, started_at as startedAt, ended_at as endedAt, metadata, outcome FROM runs ORDER BY started_at DESC").all().map(parseRow).map((run: any) => {
      const events = this.db.prepare("SELECT environment, status, type FROM events WHERE run_id = ? ORDER BY sequence").all(run.id) as Array<{ environment: Environment; status: EventStatus; type: string }>
      const artifacts = this.db.prepare("SELECT 1 FROM artifacts WHERE run_id = ?").all(run.id)
      const started = Date.parse(run.startedAt)
      const ended = run.endedAt ? Date.parse(run.endedAt) : Date.now()
      return {
        ...run,
        environments: [...new Set(events.map(event => event.environment).filter(environment => environment !== "agent"))],
        decisionCount: events.filter(event => event.type === "agent.decision").length,
        failureCount: events.filter(event => event.status === "failed").length,
        artifactCount: artifacts.length,
        duration: Number.isFinite(started) && Number.isFinite(ended) ? formatDuration(Math.max(0, ended - started)) : undefined,
        currentAction: events.at(-1)?.type
      }
    })
  }

  run(runId: string): { run: unknown; events: unknown[]; artifacts: unknown[] } | undefined {
    const run = this.db.prepare("SELECT id, name, status, started_at as startedAt, ended_at as endedAt, metadata, outcome FROM runs WHERE id = ?").get(runId)
    if (!run) return undefined
    const events = this.db.prepare("SELECT id, sequence, run_id as runId, operation_id as operationId, parent_operation_id as parentOperationId, source_timestamp as sourceTimestamp, received_timestamp as receivedTimestamp, environment, provenance, type, status, summary, attributes, artifact_ids as artifactIds FROM events WHERE run_id = ? ORDER BY sequence").all(runId).map(parseRow)
    const artifacts = this.db.prepare("SELECT id, run_id as runId, environment, type, state, summary, content, metadata, created_at as createdAt, producer_operation_id as producerOperationId, content_type as contentType, sha256 FROM artifacts WHERE run_id = ? ORDER BY created_at").all(runId).map(parseRow)
    return { run: parseRow(run), events, artifacts }
  }

  artifact(artifactId: string): any | undefined {
    const row = this.db.prepare("SELECT id, run_id as runId, environment, type, state, summary, content, metadata, created_at as createdAt, producer_operation_id as producerOperationId, content_type as contentType, sha256 FROM artifacts WHERE id = ?").get(artifactId)
    return row ? parseRow(row) : undefined
  }

  assertArtifact(runId: string, artifactId: string): void {
    const row = this.db.prepare("SELECT run_id as runId FROM artifacts WHERE id = ?").get(artifactId) as { runId?: string } | undefined
    if (!row || row.runId !== runId) throw new Error(`Artifact ${artifactId} is not owned by run ${runId}`)
  }

  assertEvidence(runId: string, evidence: { operationId: string; artifactId: string }): void {
    const artifact = this.db.prepare("SELECT run_id as runId, producer_operation_id as producerOperationId FROM artifacts WHERE id = ?").get(evidence.artifactId) as { runId?: string; producerOperationId?: string } | undefined
    if (!artifact || artifact.runId !== runId) throw new Error(`Artifact ${evidence.artifactId} is not owned by run ${runId}`)
    if (artifact.producerOperationId !== evidence.operationId) throw new Error(`Operation ${evidence.operationId} did not produce artifact ${evidence.artifactId}`)
    const operation = this.db.prepare("SELECT 1 FROM events WHERE run_id = ? AND operation_id = ? LIMIT 1").get(runId, evidence.operationId)
    if (!operation) throw new Error(`Operation ${evidence.operationId} is not owned by run ${runId}`)
  }

  reviewArtifact(artifactId: string, reviewed: boolean): boolean {
    const row = this.db.prepare("SELECT metadata FROM artifacts WHERE id = ?").get(artifactId) as { metadata?: string } | undefined
    if (!row) return false
    let metadata: Record<string, unknown> = {}
    try { metadata = JSON.parse(row.metadata ?? "{}") } catch { /* preserve a usable review marker */ }
    metadata.reviewedForSharing = reviewed
    this.db.prepare("UPDATE artifacts SET metadata = ? WHERE id = ?").run(JSON.stringify(redact(metadata)), artifactId)
    return true
  }

  eventsSince(runId: string, sequence: number): unknown[] {
    return this.db.prepare("SELECT id, sequence, run_id as runId, operation_id as operationId, parent_operation_id as parentOperationId, source_timestamp as sourceTimestamp, received_timestamp as receivedTimestamp, environment, provenance, type, status, summary, attributes, artifact_ids as artifactIds FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence").all(runId, sequence).map(parseRow)
  }

  seedSample(): string {
    const existing = this.db.prepare("SELECT id FROM runs WHERE id = 'sample-run'").get()
    if (existing) return "sample-run"
    this.db.prepare("INSERT INTO runs (id, name, status, started_at, ended_at, metadata, outcome) VALUES ('sample-run', 'Illustrative run · sample', 'completed', datetime('now', '-1 minute'), datetime('now'), ?, ?)").run(JSON.stringify({ model: "sample-data", workflow: "illustrative", sample: true }), JSON.stringify({ executionStatus: "completed", taskOutcome: "blocked", diagnosis: "inconclusive", cleanupStatus: "succeeded", stages: { browser: "incomplete", sandbox: "incomplete", desktop: "incomplete" } }))
    const run = new LensRun(this, "sample-run")
    const add = (environment: Environment, provenance: Provenance, type: string, summary: string, attributes: Record<string, unknown> = {}) => run.event({ operationId: id("sample-op"), environment, provenance, type, status: "succeeded", summary, attributes, artifactIds: [] })
    add("agent", "operator", "run.started", "Complete checkout or identify and document the blocker")
    add("sandbox", "observed", "sandbox.preview.ready", "Fixture preview is reachable from Solari")
    add("browser", "observed", "browser.navigate", "Opened the checkout fixture")
    add("browser", "observed", "browser.observe", "Payment control is disabled after address submission", { visible: "Payment unavailable" })
    const screenshot = "sample-browser-screenshot"
    this.saveArtifact({ artifactId: screenshot, runId: "sample-run", environment: "browser", type: "screenshot", state: "ready", summary: "Illustrative screenshot placeholder", content: "synthetic-screenshot", metadata: { reviewedForSharing: false } })
    add("agent", "agent-reported", "agent.decision", "The visible state is blocked; inspect fixture evidence before retrying", { observation: "Payment control disabled", nextAction: "inspect sandbox evidence" })
    add("desktop", "observed", "desktop.screenshot", "Desktop independently confirms the blocked payment state", { actions: 3 })
    this.saveArtifact({ artifactId: "sample-diagnosis", runId: "sample-run", environment: "sandbox", type: "report", state: "ready", summary: "Schema mismatch diagnosis", content: "Derived diagnosis: the form submits zipCode while the fixture expects postalCode.", metadata: { reviewedForSharing: true } })
    add("sandbox", "derived", "sandbox.diagnosis", "Illustrative diagnosis only; live evidence has not been collected", { evidenceCoverage: "synthetic" })
    add("agent", "operator", "run.ended", "Illustrative run; checkout blocked; live diagnosis remains inconclusive")
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
  if (value === null || typeof value !== "object") return value
  if (value instanceof Error) return { kind: value.name, message: value.message }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarize(item))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return { kind: (value as { constructor?: { name?: string } }).constructor?.name ?? "object" }
  }
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, summarize(item)]))
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
