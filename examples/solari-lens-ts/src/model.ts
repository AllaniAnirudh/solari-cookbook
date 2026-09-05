import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { finishTool } from "./assessment.js"

type Message = { role: "system" | "user" | "assistant" | "tool"; content: unknown; tool_call_id?: string; tool_calls?: unknown[] }

export type ToolDefinition = {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type ToolChoice = "auto" | "none" | { type: "function"; function: { name: string } }

export type ModelResponse = {
  message: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
}

export class OpenCodeModel {
  private readonly baseUrl = (process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/go/v1").replace(/\/$/, "")
  private readonly model = normalizeModel(process.env.MODEL_NAME ?? "deepseek-v4-flash-vision-exp")
  private readonly apiKey = process.env.OPENCODE_API_KEY ?? configuredGoKey()
  private readonly timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS ?? 60_000)

  assertConfigured(): void {
    if (!this.apiKey) throw new Error("OPENCODE_API_KEY is required, or configure OpenCode Go with `opencode providers login`")
    if ((process.env.OPENCODE_PROTOCOL ?? "chat-completions") !== "chat-completions") throw new Error("This prototype currently supports OPENCODE_PROTOCOL=chat-completions only")
  }

  async complete(messages: Message[], tools: ToolDefinition[], runId: string, signal?: AbortSignal, options: { toolChoice?: ToolChoice } = {}): Promise<ModelResponse["message"]> {
    this.assertConfigured()
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs)
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "user-agent": "solari-lens-demo/0.1",
        "x-opencode-session": runId
      },
      body: JSON.stringify({ model: this.model, messages, tools, tool_choice: options.toolChoice ?? "auto", temperature: 0 }),
      signal: requestSignal
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenCode model request failed (${response.status}): ${body.slice(0, 500)}`)
    }
    const json = await response.json() as { choices?: Array<{ message?: ModelResponse["message"] }> }
    const message = json.choices?.[0]?.message
    if (!message) throw new Error("OpenCode returned no assistant message")
    return message
  }
}

function normalizeModel(model: string): string {
  return model.startsWith("opencode-go/") ? model.slice("opencode-go/".length) : model
}

export function configuredGoKeyAvailable(): boolean {
  return Boolean(configuredGoKey())
}

function configuredGoKey(): string | undefined {
  try {
    const path = `${homedir()}/.local/share/opencode/auth.json`
    const auth = JSON.parse(readFileSync(path, "utf8")) as { "opencode-go"?: { key?: string } }
    return auth["opencode-go"]?.key
  } catch {
    return undefined
  }
}

export const browserTools: ToolDefinition[] = [
  finishTool,
  { type: "function", function: { name: "observe", description: "Read visible page text and capture a screenshot.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "click", description: "Click one visible button or control by accessible role and name.", parameters: { type: "object", properties: { role: { type: "string" }, name: { type: "string" } }, required: ["role", "name"], additionalProperties: false } } },
  { type: "function", function: { name: "type", description: "Type into a visible form field by label.", parameters: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false } } }
]

export const desktopTools: ToolDefinition[] = [
  finishTool,
  { type: "function", function: { name: "observe_screen", description: "Capture and inspect the current desktop screenshot.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "click", description: "Click an absolute screen coordinate visible in the screenshot.", parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false } } },
  { type: "function", function: { name: "type", description: "Type synthetic test data into the focused desktop field.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } }
]

export function textContent(content: unknown): string {
  if (typeof content === "string") return content
  return JSON.stringify(content)
}
