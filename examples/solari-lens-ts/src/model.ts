type Message = { role: "system" | "user" | "assistant" | "tool"; content: unknown; tool_call_id?: string; tool_calls?: unknown[] }

export type ToolDefinition = {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type ModelResponse = {
  message: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
}

export class OpenCodeModel {
  private readonly baseUrl = (process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/go/v1").replace(/\/$/, "")
  private readonly model = process.env.MODEL_NAME
  private readonly apiKey = process.env.OPENCODE_API_KEY

  assertConfigured(): void {
    if (!this.apiKey) throw new Error("OPENCODE_API_KEY is required for demo:live")
    if (!this.model) throw new Error("MODEL_NAME is required for demo:live; choose a model verified with doctor")
    if ((process.env.OPENCODE_PROTOCOL ?? "chat-completions") !== "chat-completions") throw new Error("This prototype currently supports OPENCODE_PROTOCOL=chat-completions only")
  }

  async complete(messages: Message[], tools: ToolDefinition[], runId: string): Promise<ModelResponse["message"]> {
    this.assertConfigured()
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "user-agent": "solari-lens-demo/0.1",
        "x-opencode-session": runId
      },
      body: JSON.stringify({ model: this.model, messages, tools, tool_choice: "auto", temperature: 0 })
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

export const browserTools: ToolDefinition[] = [
  { type: "function", function: { name: "observe", description: "Read visible page text and capture a screenshot.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "click", description: "Click one visible button or control by accessible role and name.", parameters: { type: "object", properties: { role: { type: "string" }, name: { type: "string" } }, required: ["role", "name"], additionalProperties: false } } },
  { type: "function", function: { name: "type", description: "Type into a visible form field by label.", parameters: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false } } }
]

export const desktopTools: ToolDefinition[] = [
  { type: "function", function: { name: "observe_screen", description: "Capture and inspect the current desktop screenshot.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "click", description: "Click an absolute screen coordinate visible in the screenshot.", parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false } } },
  { type: "function", function: { name: "type", description: "Type synthetic test data into the focused desktop field.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } }
]

export function textContent(content: unknown): string {
  if (typeof content === "string") return content
  return JSON.stringify(content)
}
