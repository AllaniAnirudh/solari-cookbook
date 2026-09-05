# Solari Lens

Solari Lens is a proposed Solari feature that turns one agent run across Browser, Sandbox, and Desktop into an evidence-linked timeline. The example is intentionally local and self-contained: the checkout fixture is synthetic, the diagnosis is deterministic, and the live model path is optional.

## Architecture and orchestration

- [Implementation plan](PLAN.md): feature scope, event contract, business packaging, and verification requirements.
- [Decision tree](DECISION_TREE.md): prerequisites, environment handoffs, failure branches, and release gates.
- [Implementation audit](IMPLEMENTATION_AUDIT.md): known gaps and the distinction between intended behavior and verified implementation.

The intended sequence is Sandbox fixture -> Browser investigation -> independent Desktop confirmation -> Sandbox evidence analysis -> Lens outcome and cleanup. The plan describes the target implementation; the release gates are not yet met.

## Run the credential-free sample

```bash
npm install
npm run demo:sample
```

Open the printed dashboard URL. The current sample is synthetic demonstration data, not a genuine captured run. Replacing it with a reviewed real capture is a release requirement.

## Run the live workflow

The live workflow requires Solari capacity for one browser, one sandbox, and one desktop concurrently, plus an OpenCode Go model with tool calling and screenshot input. Solari credits cover the execution environments; OpenCode Go model usage is a separate provider subscription and has its own limits.

```bash
cp .env.example .env
# fill in SOLARI_API_KEY; OpenCode Go may use the existing local CLI auth
npm run doctor
npm run demo:live
```

The implementation uses the OpenCode Go chat-completions protocol by default and selects `deepseek-v4-flash-vision-exp` unless `MODEL_NAME` is set. It accepts `OPENCODE_API_KEY` or the existing OpenCode CLI credential at `~/.local/share/opencode/auth.json`. Confirm the chosen model and protocol through the [OpenCode Go documentation](https://opencode.ai/docs/go/) before running it.

## Intended workflow

1. The Sandbox hosts a deterministic checkout fixture and exposes a preview URL.
2. A real Browser agent attempts checkout and records observations and evidence.
3. A real Desktop agent independently confirms the visible blocked state with bounded screenshot-driven actions.
4. The Sandbox analyzes sanitized evidence from both environments and writes a diagnosis.
5. Lens presents the investigation, checkout outcome, stage status, evidence provenance, and cleanup state.

The desktop stage is limited to 10 actions or 90 seconds. The model receives the task and fixture state, not the seeded diagnosis. Scripted coordinates are not used as a fallback for model control.

## Integration boundary

Lens instruments an agent's tool dispatcher rather than proxying every Solari SDK object:

```ts
await run.executeTool({
  environment: "browser",
  tool: "click",
  input: { role: "button", name: "Pay" },
  execute: () => page.getByRole("button", { name: "Pay" }).click()
});
```

The local event store is SQLite. Events use monotonic sequences for the live SSE timeline. Optional host-configured OpenTelemetry is planned. Text redaction and reviewed export handling are under implementation; screenshots require separate review because pixels can contain credentials.

## Verification

```bash
npm test
```

Before making the full cross-environment claim, run three fresh live runs with confirmed cleanup and review the sanitized sample. Browser replay playback is an enhancement; screenshots and action events are the baseline evidence.

## Scope

This is a proposed feature inside Solari, not a separate hosted SaaS product. Runtime billing, Lens accounts, hosted retention, desktop streaming, raw chain-of-thought, and transparent SDK-wide wrappers are outside this submission. Future packaging should align with Solari's existing organization and replay-retention model rather than inventing a second billing system. Lens does not bundle or resell model inference; the demo's OpenCode Go usage remains governed by OpenCode's subscription and limits.

Solari references: [TypeScript SDK](https://docs.getsolari.com/sdk/typescript), [VMs](https://docs.getsolari.com/desktops), [Sandboxes](https://docs.getsolari.com/sandboxes), and [recording](https://docs.getsolari.com/recording).
