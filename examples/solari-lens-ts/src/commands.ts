import type { Environment, LensRun } from "./lens.js"

export type CommandResult = { exitCode: number; stdout: string; stderr: string; stdoutTruncated?: boolean; stderrTruncated?: boolean }

export class CommandFailure extends Error {
  constructor(readonly result: CommandResult) {
    super(`Command exited with code ${result.exitCode}`)
    this.name = "CommandFailure"
  }
}

export function executeCommand<T extends CommandResult>(run: LensRun, input: {
  environment: Extract<Environment, "sandbox" | "desktop">
  tool: string
  execute: () => Promise<T>
}): Promise<T & CommandResult> {
  return run.executeTool({ ...input, execute: async () => {
    const result = boundOutput(await input.execute())
    if (result.exitCode !== 0) throw new CommandFailure(result)
    return result as T & CommandResult
  } })
}

const MAX_OUTPUT_BYTES = 64 * 1024

function boundOutput(result: CommandResult): CommandResult {
  const stdout = truncate(result.stdout)
  const stderr = truncate(result.stderr)
  if (!stdout.truncated && !stderr.truncated) return result
  return { ...result, stdout: stdout.value, stderr: stderr.value, ...(stdout.truncated ? { stdoutTruncated: true } : {}), ...(stderr.truncated ? { stderrTruncated: true } : {}) }
}

function truncate(value: string): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= MAX_OUTPUT_BYTES) return { value, truncated: false }
  const suffix = "\n[output truncated]"
  let result = value.slice(0, MAX_OUTPUT_BYTES - Buffer.byteLength(suffix, "utf8"))
  while (Buffer.byteLength(result, "utf8") + Buffer.byteLength(suffix, "utf8") > MAX_OUTPUT_BYTES) result = result.slice(0, -1)
  return { value: result + suffix, truncated: true }
}
