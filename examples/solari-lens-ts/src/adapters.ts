import { executeCommand, type CommandResult } from "./commands.js"
import type { LensRun } from "./lens.js"

type Screenshot = Uint8Array

export type BrowserAdapter = ReturnType<typeof browserAdapter>
export type SandboxAdapter = ReturnType<typeof sandboxAdapter>
export type DesktopAdapter = ReturnType<typeof desktopAdapter>

export function browserAdapter(run: LensRun, driver: {
  navigate: (url: string) => Promise<unknown>
  readPage: () => Promise<string>
  screenshot: () => Promise<Screenshot>
  click: (role: string, name: string) => Promise<unknown>
  type: (label: string, value: string) => Promise<unknown>
}) {
  return {
    navigate: (url: string) => run.executeTool({ environment: "browser", tool: "navigate", input: { url }, execute: () => driver.navigate(url) }),
    click: (role: string, name: string) => run.executeTool({ environment: "browser", tool: "click", input: { role, name }, execute: () => driver.click(role, name) }),
    type: (label: string, value: string) => run.executeTool({ environment: "browser", tool: "type", input: { label, value }, execute: () => driver.type(label, value) }),
    observe: async () => {
      const observed = await run.executeTool({ environment: "browser", tool: "observe", execute: async () => ({ text: await driver.readPage(), bytes: await driver.screenshot() }) })
      const artifactId = run.artifact({ environment: "browser", type: "screenshot", state: "ready", summary: "Browser observation screenshot", content: Buffer.from(observed.bytes).toString("base64"), metadata: { bytes: observed.bytes.byteLength, reviewedForSharing: false } })
      return { text: observed.text, artifactId, screenshot: `data:image/png;base64,${Buffer.from(observed.bytes).toString("base64")}` }
    }
  }
}

export function sandboxAdapter(run: LensRun, driver: {
  command: (command: string, args: string[]) => Promise<CommandResult>
  writeFile: (path: string, content: string) => Promise<unknown>
  readFile: (path: string) => Promise<string>
  preview: (port: number) => Promise<string | { url: string; token?: string }>
  metrics?: () => Promise<unknown>
}) {
  return {
    command: (tool: string, command: string, args: string[]) => executeCommand(run, { environment: "sandbox", tool, execute: () => driver.command(command, args) }),
    writeFile: (path: string, content: string) => run.executeTool({ environment: "sandbox", tool: "write_file", input: { path, bytes: content.length }, execute: () => driver.writeFile(path, content) }),
    readFile: (path: string) => run.executeTool({ environment: "sandbox", tool: "read_file", input: { path }, execute: () => driver.readFile(path) }),
    preview: (port: number) => run.executeTool({ environment: "sandbox", tool: "preview", input: { port }, execute: () => driver.preview(port) }),
    metrics: driver.metrics ? () => run.executeTool({ environment: "sandbox", tool: "metrics", execute: () => driver.metrics!() }) : undefined
  }
}

export function desktopAdapter(run: LensRun, driver: {
  screenshot: () => Promise<Screenshot>
  click: (x: number, y: number) => Promise<unknown>
  type: (text: string) => Promise<unknown>
  command?: (command: string, args: string[]) => Promise<CommandResult>
}) {
  return {
    observe: async () => {
      const bytes = await run.executeTool({ environment: "desktop", tool: "screenshot", execute: () => driver.screenshot() })
      const artifactId = run.artifact({ environment: "desktop", type: "screenshot", state: "ready", summary: "Desktop observation screenshot", content: Buffer.from(bytes).toString("base64"), metadata: { bytes: bytes.byteLength, reviewedForSharing: false } })
      return { artifactId, screenshot: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` }
    },
    click: (x: number, y: number) => run.executeTool({ environment: "desktop", tool: "click", input: { x, y }, execute: () => driver.click(x, y) }),
    type: (text: string) => run.executeTool({ environment: "desktop", tool: "type", input: { text: "[synthetic]" }, execute: () => driver.type(text) }),
    command: driver.command ? (tool: string, command: string, args: string[]) => executeCommand(run, { environment: "desktop", tool, execute: () => driver.command!(command, args) }) : undefined
  }
}
