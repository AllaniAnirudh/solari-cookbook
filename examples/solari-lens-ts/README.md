# Solari Lens

Solari Lens is a proposed Solari feature that turns one agent run across Browser, Sandbox, and Desktop into an evidence-linked timeline. The example is intentionally local and self-contained: the checkout fixture is synthetic, the diagnosis is deterministic, and the live model path is optional.

## Run the credential-free sample

```bash
npm install
npm run demo:sample
```

Open the printed dashboard URL. The sample contains a genuine three-environment-shaped trace without requiring Solari or model credentials.

## Run the live workflow

The live workflow requires Solari capacity for one browser, one sandbox, and one desktop concurrently, plus an OpenCode Go model with tool calling and screenshot input.

```bash
cp .env.example .env
# fill in SOLARI_API_KEY, OPENCODE_API_KEY, and MODEL_NAME
npm run doctor
npm run demo:live
```

The implementation uses the OpenCode Go chat-completions protocol by default. Confirm the chosen model and protocol through the [OpenCode Go documentation](https://opencode.ai/docs/go/) before running it.

## What the demo proves

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

The local event store is SQLite. Events use monotonic sequences for the live SSE timeline. OpenTelemetry is an optional host-configured emission path. Inputs, logs, capability URLs, and metadata are redacted before persistence.

## Verification

```bash
npm test
```

Before making the full cross-environment claim, run three fresh live runs with confirmed cleanup and review the sanitized sample. Browser replay playback is an enhancement; screenshots and action events are the baseline evidence.

## Scope

This is a proposed feature inside Solari, not a separate hosted SaaS product. Runtime billing, Lens accounts, hosted retention, desktop streaming, raw chain-of-thought, and transparent SDK-wide wrappers are outside this submission. Future packaging should align with Solari's existing organization and replay-retention model rather than inventing a second billing system.

Solari references: [TypeScript SDK](https://docs.getsolari.com/sdk/typescript), [VMs](https://docs.getsolari.com/desktops), [Sandboxes](https://docs.getsolari.com/sandboxes), and [recording](https://docs.getsolari.com/recording).
