# Solari Lens

Solari Lens is a proposed Solari feature that helps developers understand an agent run after something goes wrong.

The demo follows one checkout attempt through three Solari environments:

1. A Sandbox runs the checkout fixture and records sanitized request logs.
2. A Browser agent attempts the checkout and captures its actions and screenshots.
3. A Desktop agent independently checks the visible result.
4. The Sandbox analyzes the evidence.
5. Lens shows the run as a timeline with linked evidence and separate outcomes.

Checkout is the demonstration scenario. Lens itself is the reusable part: the event model, evidence handling, adapters, and dashboard.

Lens has two audiences. End users and developers use it to understand a single run and fix the immediate problem. Solari teams and customer engineering teams can use the same data across many runs to find recurring failures, unnecessary agent actions, slow environments, and opportunities to improve reliability and efficiency. This repository demonstrates the first use case; hosted aggregation and organization-level analytics are future product work.

## Start Here

The sample runs without credentials:

```bash
npm install
npm run demo:sample
```

Open the dashboard URL printed in the terminal. It shows the Lens workflow and its evidence model using illustrative data.

For a real run, configure `SOLARI_API_KEY`. OpenCode Go can use the existing local CLI login or `OPENCODE_API_KEY`:

```bash
npm run doctor
npm run demo:live
```

The live run needs one Browser, one Sandbox, and one Desktop session at the same time. `npm run doctor` creates temporary resources, checks the complete path, and verifies cleanup.

To run once and exit after cleanup:

```bash
LENS_RUN_ONCE=1 npm run demo:live
```

## What The Demo Shows

The fixture contains a deliberate payment defect. The server expects `postalCode`, while the submitted payment request contains `zipCode`. The customer-facing page only says that payment could not be completed.

Lens makes the distinction visible:

- The checkout is blocked.
- The investigation completed.
- The diagnosis is supported by the sanitized request log and screenshots.
- The Desktop result is labeled as independent visual confirmation.
- Cleanup is reported separately and is confirmed against Solari's remote state.

Lens does not collect or display raw chain of thought. The model can submit a short, evidence-linked assessment, labeled `agent-reported`.

## Implementation

`run.executeTool()` is the instrumentation boundary. It records the operation, environment, status, redacted inputs and outputs, and linked artifacts while returning the original result to the agent.

The demo has narrow adapters for the exact Browser, Sandbox, and Desktop operations it uses. SQLite stores the local event and artifact index. Server-Sent Events stream new events to the dashboard and resume with `Last-Event-ID`.

The public `Lens` facade and the adapters show the intended feature boundary. The live checkout orchestration is deliberately kept in the example rather than presented as a general SDK wrapper.

## Evidence And Safety

- Every artifact belongs to a run and records its producing operation.
- Screenshots are local-only until explicitly marked for sharing.
- Signed preview URLs, tokens, headers, and sensitive text are redacted before persistence and export.
- The terminal assessment request forces the `finish` function, so the model cannot continue clicking after its action budget is over.
- A supported diagnosis can include caveats. Caveats are shown separately from evidence blockers.
- Cleanup is successful only after Solari reports the session as gone or definitively not found.

## Current Status

Verified locally:

- TypeScript compilation.
- 27 unit and integration tests.
- Browser, Sandbox, and Desktop adapters.
- Dashboard, SSE reconnect, redaction, evidence ownership, and reviewed export behavior.

Verified against Solari and OpenCode Go:

- Sandbox preview content.
- Browser rendering.
- Desktop readiness and browser discovery.
- Model screenshot interpretation and visible mouse input.
- One complete live run with a supported blocked-checkout diagnosis.
- Zero remaining Sandbox or Desktop resources after the run.

The full public claim still requires three consecutive fresh live runs and a human-reviewed credential-free sample. The repository does not claim that Lens is an officially shipped Solari feature.

## Documents

- [Feature overview](docs/FEATURE.md)
- [Implementation plan](PLAN.md)
- [Decision tree](DECISION_TREE.md)
- [Implementation audit](IMPLEMENTATION_AUDIT.md)

## References

- [Solari TypeScript SDK](https://docs.getsolari.com/sdk/typescript)
- [Solari Sandboxes](https://docs.getsolari.com/sandboxes)
- [Solari Desktops](https://docs.getsolari.com/desktops)
- [Solari recording](https://docs.getsolari.com/recording)
- [OpenCode Go](https://opencode.ai/docs/go/)
