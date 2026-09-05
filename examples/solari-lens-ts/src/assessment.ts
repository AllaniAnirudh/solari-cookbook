export type Assessment = {
  outcome: "blocked" | "succeeded" | "inconclusive"
  summary: string
  artifactIds: string[]
}

// Each stage owns its tracker, so evidence from another run or environment cannot qualify.
export class AssessmentEvidence {
  private actions = 0
  private screenshots = new Map<string, number>()

  actionSucceeded(): void { this.actions++ }
  screenshotCaptured(id: string): void { this.screenshots.set(id, this.actions) }

  validate(value: unknown): Assessment {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Assessment must be an object")
    const input = value as Record<string, unknown>
    if (Object.keys(input).some(key => !["outcome", "summary", "artifactIds"].includes(key))) throw new Error("Unknown assessment field")
    if (!["blocked", "succeeded", "inconclusive"].includes(String(input.outcome))) throw new Error("Invalid assessment outcome")
    if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 2000) throw new Error("Assessment summary must contain 1-2000 characters")
    if (!Array.isArray(input.artifactIds) || input.artifactIds.length > 10 || input.artifactIds.some(id => typeof id !== "string" || !this.screenshots.has(id))) throw new Error("Reference only screenshot artifact IDs returned by this stage")
    const ids = [...new Set(input.artifactIds as string[])]
    if (input.outcome !== "inconclusive" && (!this.actions || !ids.some(id => this.screenshots.get(id) === this.actions))) throw new Error("Observe the screen after your latest successful action before assessing its outcome")
    return { outcome: input.outcome as Assessment["outcome"], summary: input.summary.trim(), artifactIds: ids }
  }
}

export const finishTool = {
  type: "function" as const,
  function: {
    name: "finish",
    description: "Submit the observed outcome with screenshot artifact IDs. Call alone, after observing the result of your actions. Use inconclusive when evidence is insufficient. Do not infer a root cause.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        outcome: { type: "string", enum: ["blocked", "succeeded", "inconclusive"] },
        summary: { type: "string", minLength: 1, maxLength: 2000 },
        artifactIds: { type: "array", items: { type: "string" }, maxItems: 10 }
      },
      required: ["outcome", "summary", "artifactIds"]
    }
  }
}
