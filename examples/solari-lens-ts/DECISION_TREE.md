# Solari Lens Project Implementation Decision Tree

## Purpose

This document converts the project plan and multi-agent review into implementation decisions. It is the release guide for building Solari Lens as a proposed Solari feature, not a separate SaaS product.

The product promise is:

> One agent run. Three Solari environments. One evidence-linked explanation of what failed.

The submission targets a genuine model-driven run using Solari Browser, Sandbox, and Desktop. Do not publicly claim successful three-environment support until a real run passes every release gate below.

## Top-Level Decision Tree

```text
Start
|
+-- Is the implementation inside a public solari-cookbook fork?
|   +-- No -> Create examples/solari-lens-ts in the fork before product work.
|   `-- Yes -> Continue.
|
+-- Does `npm run doctor` pass the account and platform checks?
|   +-- No -> Report the exact failed prerequisite; do not start a live run.
|   `-- Yes -> Continue.
|
+-- Can one real workflow use all three Solari environments?
|   +-- No -> Keep failed/unsupported stages visible and do not claim full support.
|   `-- Yes -> Run the complete investigation.
|
+-- Did the complete workflow produce independently sourced evidence?
|   +-- No -> Mark the affected artifact or stage unavailable; never simulate it.
|   `-- Yes -> Generate the final diagnosis and sanitized sample.
|
+-- Did three consecutive fresh runs pass with confirmed cleanup?
|   +-- No -> Fix reliability before using the three-environment headline.
|   `-- Yes -> Record the demo, bundle the sample, and prepare the submission.
```

## 1. Repository and Reviewer Entry Point

### Decision

Implement Lens as one self-contained example under `examples/solari-lens-ts` in a public fork of the [Solari Cookbook](https://github.com/solari-sdk/solari-cookbook/). The cookbook favors small, complete, runnable examples, so the project must have one obvious entry point even though the implementation contains several internal modules.

### Required commands

- `npm run demo:sample`: open a bundled, sanitized, genuine three-environment run without credentials.
- `npm run doctor`: perform read-only or temporary compatibility checks and clean up anything it creates.
- `npm run demo:live`: execute the real model-driven workflow.
- `npm test`: run focused unit and integration tests that do not require a reviewer to inspect output manually.

### Decision branch

```text
Can a reviewer understand Lens without credentials?
+-- No -> Submission is blocked; finish `demo:sample` first.
`-- Yes -> Live execution may remain an optional second path.
```

## 2. Preflight and Account Requirements

`npm run doctor` must validate each prerequisite without printing secrets or capability-bearing URLs.

### Solari checks

- A rotated `SOLARI_API_KEY` is present and accepted.
- The account can create a browser, sandbox, and desktop.
- The fixture sandbox and desktop can run concurrently. This requires Solari Starter or equivalent capacity because the current Free plan allows one concurrent sandbox/VM, while Starter allows two.
- A sandbox preview returns the expected fixture content from both a Solari browser and a Solari desktop.
- Every temporary resource created by the doctor is explicitly destroyed and verified.

### Model checks

- `OPENCODE_API_KEY` is accepted by OpenCode Go.
- The selected model completes a tool-call/result loop.
- The selected model accepts a desktop screenshot and identifies a visible control correctly.
- Model output validates against the action and decision schemas.
- Quota errors are detected and reported without enabling paid fallback.

### Desktop checks

- Create, connect, and `health().ready` succeed.
- An installed browser is discovered at runtime with `command -v`; prefer the first verified Chrome/Chromium executable, then Firefox.
- A `1280x720` screenshot is nonblank and contains the expected fixture state.
- Mouse and keyboard input cause a visible state change.
- The desktop is destroyed after both successful and failed checks.

### Decision branch

```text
Doctor result
+-- Missing credentials -> Stop and show setup instructions.
+-- Insufficient Solari capacity -> Stop and report the required plan/capacity.
+-- Preview inaccessible -> Stop; the workflow cannot use the sandbox fixture.
+-- Model lacks tool calling -> Select another available Go model and retest.
+-- Model lacks screenshot support -> Do not call desktop model-driven.
+-- Desktop input or screenshot fails -> Mark desktop unsupported and fix before release.
`-- All checks pass -> Permit `demo:live`.
```

References: [Solari TypeScript SDK](https://docs.getsolari.com/sdk/typescript), [Solari desktop SDK](https://docs.getsolari.com/sdk/typescript/vms), [Solari pricing](https://docs.getsolari.com/pricing), and [OpenCode Go](https://opencode.ai/docs/go/).

## 3. Runtime Architecture

### Decision: instrument the tool boundary

Do not transparently proxy entire Solari clients, Playwright pages, locators, sessions, or callbacks in v1. That would require broad behavioral parity and would consume the project without improving the core demo.

All agent tools use one public execution boundary:

```ts
await run.executeTool({
  environment: "browser",
  tool: "click",
  input,
  execute: () => page.getByRole("button", { name: "Pay" }).click()
});
```

Build three thin adapters on top of `executeTool()`:

- Browser normalizes navigation, visible observations, actions, screenshots, errors, and replay state.
- Sandbox normalizes preview creation, commands, files, metrics, exit codes, and cleanup.
- Desktop normalizes health, screenshots, mouse/keyboard actions, shell commands, and cleanup.

Also expose `run.step()`, `run.decision()`, `run.artifact()`, and `run.end()`. SDK-wide `wrapBrowser()`, `wrapSandbox()`, and `wrapDesktop()` remain future work.

### Decision: canonical event pipeline

```text
Model tool request
  -> capture-time redaction
  -> executeTool()
  -> narrow Solari adapter
  -> append-only SQLite event
  +-> SSE live update
  `-> optional OpenTelemetry emission
```

- SQLite is the canonical local run, event, and artifact index.
- A server-assigned monotonic sequence determines display order across environments.
- SSE uses that sequence as the event ID and resumes from `Last-Event-ID`.
- Lens uses `@opentelemetry/api` with an optional host-supplied tracer.
- The demo host initializes the OpenTelemetry SDK; the Lens library must not replace global telemetry configuration.
- Telemetry failure must never change the underlying Solari operation result.

### Minimum event contract

```ts
type LensEvent = {
  id: string;
  sequence: number;
  runId: string;
  operationId: string;
  parentOperationId?: string;
  sourceTimestamp: string;
  receivedTimestamp: string;
  environment: "agent" | "browser" | "sandbox" | "desktop";
  provenance: "observed" | "agent-reported" | "derived" | "operator";
  type: string;
  status: "started" | "succeeded" | "failed" | "pending" | "unsupported";
  summary: string;
  attributes: Record<string, unknown>;
  artifactIds: string[];
};
```

Use `artifactId` and `operationId` for product-level evidence links. Span IDs remain telemetry implementation details.

## 4. Three-Environment Workflow

### Fixed execution order

```text
1. Sandbox starts the deterministic checkout fixture
2. Browser agent attempts checkout and discovers the failure
3. Desktop agent independently confirms the visible failure
4. Sandbox analyzes evidence from both environments
5. Lens records the final diagnosis and cleanup outcome
```

### Sandbox role

- Host one deterministic checkout fixture using a dependency-light server.
- Expose it through a preview URL and verify actual content before continuing.
- Record structured fixture logs containing the seeded failure evidence.
- After browser and desktop finish, receive a sanitized `evidence.json` through the sandbox file API.
- Run a deterministic analyzer and return `diagnosis.json` plus `report.md`.
- Link every diagnosis claim to browser, desktop, or fixture evidence.

Limit v1 instrumentation to create/connect/kill, file write/read, foreground/background commands, preview URL creation, and a small number of metrics samples. Defer PTY, Git, snapshots, volumes, file watches, and general code-interpreter coverage.

### Browser role

- Receive the goal: "Complete checkout, or identify and document the blocker."
- Navigate the full customer workflow with a real model and bounded tools.
- Record meaningful actions, observations, screenshots, page errors, and failed requests.
- Capture agent-reported rationale only at branches, retries, environment handoffs, and the final conclusion.
- Enable Solari recording, but do not make replay playback the primary evidence path.

Browser lifecycle decision:

- When using managed `client.launch()`, call `BrowserSession.close()` once, then close the Solari client.
- When using a raw session from `sessions.create()`, call `sessions.releaseAndWait(id)` instead.
- Never invoke both release paths for the same session.

### Desktop role

Desktop is an independent visual confirmation, not a complete repetition of checkout.

- Open a run-specific fixture URL directly at the relevant checkout state.
- Do not provide the seeded defect or final diagnosis to the desktop agent.
- Let the real model interpret screenshots and select GUI actions.
- Perform two to five meaningful actions, with a hard limit of 10 actions or 90 seconds.
- Capture screenshots before and after actions and verify visible state changes.
- Produce a final screenshot showing whether the payment control remains blocked.
- Use a fixed `1280x720` display and a maximized browser.

Exclude desktop recording, embedded VNC, takeover, profiles, persistence, arbitrary applications, multi-window workflows, and scripted coordinates disguised as model control.

## 5. Evidence, Reasoning, and Outcomes

### Decision: no raw chain-of-thought

Lens displays concise, structured rationale reported by the agent. It must never claim to expose hidden reasoning or present model-generated explanations as verified truth.

Use these labels:

- `Observed`: a direct SDK or tool result.
- `Agent-reported`: a model-generated interpretation or rationale.
- `Derived`: deterministic analysis performed by Lens or the sandbox.
- `Operator`: a human annotation.

Use "evidence supporting the diagnosis," not "evidence proving the diagnosis." Recorded actions prove what was attempted; they do not prove the intended effect occurred.

### Decision: separate outcomes

```text
Investigation: succeeded | failed | incomplete
Checkout: succeeded | blocked | failed
Browser stage: succeeded | failed | unsupported | cleanup-pending
Sandbox stage: succeeded | failed | unsupported | cleanup-pending
Desktop stage: succeeded | failed | unsupported | cleanup-pending
Diagnosis: confirmed | supported | inconclusive
Cleanup: succeeded | partial | failed
```

A broken checkout can coexist with a successful investigation. A desktop failure must not erase useful browser or sandbox evidence.

### Artifact states

Every artifact records its producing operation, environment, capture time, media type, integrity hash, redaction/review state, and one of:

- `pending`
- `ready`
- `capture-failed`
- `invalid`
- `expired`
- `unsupported`

Text, logs, headers, metadata, environment values, query credentials, and capability URLs are redacted before SQLite, SSE, or OpenTelemetry. Screenshots and replays use synthetic data and are excluded from public export until explicitly marked `reviewed-for-sharing`.

Solari recordings capture input values by default. Never persist signed replay, preview, download, or desktop stream URLs as ordinary metadata. Reference: [Solari recording](https://docs.getsolari.com/recording).

## 6. UI Decision Tree

### Primary view

Use a two-pane run inspector:

- Left: concise chronological story with explicit environment handoffs.
- Right: the selected screenshot, log, report, or artifact.
- Top: sticky investigation, checkout, stage, and cleanup outcomes.

Raw spans, retries, lifecycle operations, and metrics live behind a technical-details toggle. The first screen must help a reviewer find the meaningful failure before showing architecture or pricing.

### Decision branch

```text
Selected event
+-- Has ready evidence -> Open it in the evidence pane.
+-- Evidence pending -> Show finalization status and elapsed time.
+-- Capture failed -> Show the capture error without inventing an artifact.
+-- Evidence expired -> Preserve metadata and mark provider artifact expired.
`-- Agent claim lacks evidence -> Label it "Unsupported claim."
```

Distinguish waiting on the model, remote operation, replay finalization, quota, concurrency, and cleanup. If telemetry becomes stale, display "Connection interrupted; run state unknown" with the last received time.

## 7. Replay Decision

Browser screenshots and action events are the required baseline. Embedded replay is a non-blocking enhancement.

```text
Recorded browser released
+-- Replay available within 30 seconds
|   +-- NDJSON parses and visible actions render -> Enable replay in Lens.
|   `-- Invalid or unrenderable -> Mark replay invalid; retain screenshots.
`-- Replay unavailable -> Mark unavailable; retain screenshots and action trace.
```

Do not treat a replay URL or a line count as proof of working playback. Validate the downloaded events and render a visible action sequence before advertising embedded replay.

## 8. Reliability Decisions

- Do not add an automatic retry layer around official SDK calls.
- Let each SDK perform its documented retries.
- For direct HTTP, retry documented transient failures only when the operation is idempotent.
- Do not retry concurrency `429` responses; free capacity or report the blocker.
- Use idempotency keys only on routes that document them. Do not assume every create route has the same contract.
- Treat a non-zero sandbox command exit code as operation failure even when the HTTP request succeeds.
- Bound the complete run to 40 tool calls and five minutes, with a separate 60-second cleanup window.
- Bound desktop independently to 10 GUI actions and 90 seconds.
- Cap stored stdout/stderr at 64 KiB per operation and mark truncation.
- Preserve a `cleanup-pending` state whenever destruction cannot be verified.

## 9. Release Decision Tree

```text
Candidate build
+-- Does doctor pass every three-environment preflight?
|   +-- No -> Not eligible for the full Lens claim.
|   `-- Yes -> Continue.
+-- Do three consecutive fresh live runs complete all three stages?
|   +-- No -> Diagnose reliability and rerun; no simulated success.
|   `-- Yes -> Continue.
+-- Is cleanup confirmed in all three runs?
|   +-- No -> Release blocked.
|   `-- Yes -> Continue.
+-- Is one successful run sanitized and reviewed?
|   +-- No -> Release blocked.
|   `-- Yes -> Bundle it for `demo:sample`.
+-- Do README, video, and screenshots reflect only verified behavior?
    +-- No -> Correct the claims.
    `-- Yes -> Ready for public submission.
```

If desktop never passes, Lens may still be published as a browser-and-sandbox prototype, but the repository, video, and social copy must call desktop experimental. Because the selected feature is cross-environment visibility and the challenge has no fixed deadline, the preferred decision is to continue development until the real three-environment gate passes.

## 10. Business and Packaging Decisions

### Day one

Include working product signals, not simulated commerce:

- Live cross-environment timeline.
- Named local run history and metadata labels.
- Failure and cleanup outcomes.
- Evidence provenance and availability.
- Sanitized Markdown and JSON/JSONL export.
- Session duration, environment type, machine size, and available resource metrics.

### README-only hypothesis

Lens should be bundled into Solari's existing plans, not sold as a separate subscription. That packaging covers Lens platform/storage behavior only; model inference remains the user's configured provider responsibility:

- Free: current/recent visibility and local export.
- Starter: hosted history and basic organization sharing.
- Professional: longer history, alerts, comparisons, clustering, and higher scale.
- Enterprise: access controls, auditability, export controls, and contract-specific deployment requirements.

Solari currently provides browser replay retention of 1/7/30/90 days across Free, Starter, Professional, and Enterprise. These values may inform a future Lens proposal, but they are not implemented Lens retention guarantees. Reference: [Solari pricing](https://docs.getsolari.com/pricing) and [Solari organizations](https://docs.getsolari.com/organizations).

### Exclude from implementation

- Runtime plan flags or entitlement simulation.
- Billing pages and upgrade controls.
- Separate Lens accounts, organizations, or project tokens.
- Per-span pricing or invented telemetry quotas.
- Claims about willingness to pay, retention improvements, or product-market fit without users.

## 11. Submission Decision Tree

```text
Submission package
+-- Public cookbook fork with examples/solari-lens-ts
+-- Concise README with one-command sample and live setup
+-- Genuine sanitized sample requiring no credentials
+-- 60-90 second failure-first video
+-- GIF/screenshots from the verified run
+-- Architecture diagram
+-- Test results and honest limitations
+-- Why this is useful
+-- README-only business hypothesis
+-- Public X or LinkedIn post
`-- Tag @harrychow_ and @getsolari
```

Lead the demo with the failed action, then show the linked browser evidence, desktop confirmation, sandbox diagnosis, and separate cleanup result. Architecture and packaging come afterward.

Recommended submission language:

> I built Solari Lens, a proposed visibility feature for Solari agents. One agent encountered a checkout failure across Solari Browser, Sandbox, and Desktop. Lens turned its actions, observations, reported rationale, screenshots, runtime logs, and final diagnosis into one evidence-linked timeline. Inspect the complete recorded run without credentials or execute it live with your own Solari account.

Publishing the repository or social post remains a deliberate user-authorized action.

## 12. Multi-Agent Review Perspectives

### Requirements auditor

Conditional go. The idea fits the challenge, but the implementation must live in the public cookbook fork. Browser cleanup, retries, idempotency, account concurrency, and preview access must follow the documented API contracts rather than blanket assumptions.

### Staff engineer

Technically feasible. The highest risk is transparent SDK wrapping, followed by model-driven desktop reliability. Use `executeTool()` plus narrow adapters, an append-only event store, optional host-configured OpenTelemetry, and bounded desktop preflight.

### Developer-product lead

Developers care about locating the first meaningful failure and sharing its evidence. They do not initially care about retention controls, telemetry terminology, or pricing UI. Lens must remain useful without agent decision annotations.

### Agent UX and observability specialist

Provenance labels, evidence states, capture-time redaction, and separate task/investigation/cleanup outcomes are mandatory. Agent-reported rationale must not be presented as verified internal reasoning.

### Business strategist

Lens should strengthen Solari's existing platform and plans rather than introduce another subscription. The credible day-one business evidence is integration time, diagnosis time, export usefulness, repeat usage, and resource visibility.

### Hiring and launch reviewer

The concept has strong interview potential if narrowed and polished. The submission should optimize for an immediate, credential-free reviewer experience, one memorable three-environment trace, and honest proof rather than broad platform scaffolding.

## Final Implementation Priorities

### P0: required for the submission

- Cookbook fork and sample/doctor/live entry points.
- Canonical event model, capture-time redaction, SQLite, and SSE.
- `executeTool()` plus the three narrow adapters.
- Real browser failure, bounded desktop confirmation, and sandbox diagnosis.
- Outcome separation, evidence provenance, export, cleanup, and genuine bundled sample.
- Three consecutive successful fresh runs before the full public claim.

### P1: add only after P0 is stable

- Real OpenTelemetry parenting for demonstrated operations.
- Browser replay if downloaded events parse and visibly render.
- Healthy fixture run alongside the primary failure run.
- One minimal non-checkout integration example.

### Roadmap only

- Transparent SDK-wide wrappers.
- Hosted ingestion, team sharing, alerts, analytics, and external OTLP export.
- Native Solari console, organization, access-control, retention, and billing integration.
- Desktop streaming, takeover, recording, and arbitrary application support.
