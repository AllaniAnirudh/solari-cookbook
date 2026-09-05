import type { LensStore } from "./lens.js"

export function exportRun(store: LensStore, runId: string): string | undefined {
  const data = store.run(runId)
  if (!data) return undefined
  const artifacts = data.artifacts.map((value: any) => {
    const { content, ...artifact } = value
    // Screenshot pixels may contain credentials even when metadata is redacted.
    const reviewed = artifact.metadata?.reviewedForSharing === true
    return { recordType: "artifact", ...artifact, ...(reviewed && artifact.state === "ready" ? { content } : { contentOmitted: "not reviewed or unavailable" }) }
  })
  return [
    { recordType: "run", ...data.run as object },
    ...data.events.map(event => ({ recordType: "event", ...event as object })),
    ...artifacts
  ].map(record => JSON.stringify(record)).join("\n") + "\n"
}

export function exportMarkdown(store: LensStore, runId: string): string | undefined {
  const data = store.run(runId)
  if (!data) return undefined
  const run = data.run as any
  const outcome = run.outcome ?? {}
  const lines = [
    `# ${markdownText(run.name)}`,
    "",
    `- Status: ${markdownText(run.status)}`,
    `- Started: ${markdownText(run.startedAt)}`,
    `- Ended: ${markdownText(run.endedAt ?? "in progress")}`,
    `- Investigation: ${markdownText(outcome.executionStatus ?? "unknown")}`,
    `- Task: ${markdownText(outcome.taskOutcome ?? "unknown")}`,
    `- Diagnosis: ${markdownText(outcome.diagnosis ?? "unknown")}`,
    `- Cleanup: ${markdownText(outcome.cleanupStatus ?? "unknown")}`,
    "",
    "## Run story",
    ""
  ]
  for (const event of data.events as any[]) {
    lines.push(`- **#${event.sequence} ${markdownText(event.environment)} / ${markdownText(event.status)}:** ${markdownText(event.summary)}`)
    if (event.provenance || event.artifactIds?.length) lines.push(`  - Provenance: ${markdownText(event.provenance)}${event.artifactIds?.length ? `; evidence: ${event.artifactIds.map(markdownText).join(", ")}` : ""}`)
  }
  lines.push("", "## Evidence", "")
  for (const artifact of data.artifacts as any[]) {
    const reviewed = artifact.metadata?.reviewedForSharing === true && artifact.state === "ready"
    lines.push(`- **${markdownText(artifact.type)} / ${markdownText(artifact.state)}:** ${markdownText(artifact.summary)} (${markdownText(artifact.environment)})`)
    lines.push(`  - Artifact: ${markdownText(artifact.id)}${reviewed ? "" : " (content omitted: not reviewed for sharing)"}`)
    if (reviewed && artifact.type !== "screenshot" && artifact.content) lines.push("", "  ```text", "  " + String(artifact.content).replace(/\n/g, "\n  "), "  ```")
  }
  return lines.join("\n") + "\n"
}

function markdownText(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]/g, " ").replace(/[\\`*_{}\[\]<>]/g, "\\$&")
}
