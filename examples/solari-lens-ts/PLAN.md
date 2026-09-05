# Solari Lens: Agent Visibility Across Browsers, Sandboxes, and Desktops

## Summary

Build a public, submission-quality prototype of **Solari Lens as a Solari feature** for developers and operators running agents. Users should be able to connect their own instrumented agents, watch their work live, inspect outcomes, and share failure evidence.

The three day-one questions are: What is happening now? What happened when it failed? Can I explain this to someone else? API coverage is secondary to helping users answer these questions.

The submission demonstrates the proposed console feature through public SDKs and APIs. Access to Solari's console source, account integration, and billing internals has not been established. Those native integration points are explicitly future placeholders.

Checkout investigation is an example workflow, not the feature's identity. The demo will use one real model-driven agent across all three Solari environments:

1. A sandbox runs a deterministic web application with an injected checkout defect.
2. A Solari browser agent executes the checkout workflow and records what happens.
3. A Solari desktop independently confirms the visible failure through a short, model-driven GUI interaction.
4. The sandbox analyzes the browser and desktop evidence and produces the final diagnosis.

The reviewer should understand the product within two minutes:

> Lens shows what the agent did, what it observed, the rationale it reported, and the evidence supporting where the workflow failed.

The submission should optimize for a memorable public demo while showing how the feature could increase the value of Solari's existing browser, sandbox, desktop, organization, and billing platform.

The companion [implementation decision tree](./DECISION_TREE.md) defines the concrete preflight branches, event contract, degraded states, and release checklist. If this plan and the decision tree diverge, update both before implementation continues.

## Evidence and Validation Status

Observed in completed tests:

- Browser sessions can navigate, capture screenshots, run concurrently, and produce replay artifacts.
- Browser replay retrieval succeeded with `releaseAndWait()` and polling. This does not prove other release paths cannot work. The corrected fetch test counted replay lines; structured event parsing and playback still need verification.
- Sandbox commands, non-zero exit codes, stateful code, file read/write/list/search/watch, metrics, background server start/kill, and preview URL generation passed.
- Desktop creation, health, screenshot byte retrieval, shell execution, and stream URL presence passed the earlier smoke test.

Documented capabilities, not proof of completed integration tests:
- The official TypeScript SDK provides separate browser, sandbox, and desktop clients plus a unified client for desktops, sandboxes, templates, and volumes.
- Browser control uses Playwright/CDP, while sandbox and desktop handles expose remote control operations through their documented SDK surfaces.
- The observer stream exists, but its frame schema is explicitly not guaranteed by the API contract.

- Desktop GUI input and actual fixture rendering need verification. Desktop streaming and recording are not required for the MVP.
- The combined sandbox runners produced no complete report; the cause was not established. Snapshot, revert, pause/resume, and background output completeness remain unresolved.
- Prior cleanup was not independently audited for every interrupted runner. Future tests must record and verify cleanup of their own resources.

Technical feasibility does not establish demand. We currently have no external user feedback.

## Demo Workflow

### 1. Seeded application

Create a small local checkout application with:

- Product page.
- Cart.
- Shipping form.
- Payment step.
- Order confirmation.
- Deterministic defect controlled by an environment variable.

The defect should be visible and explainable, such as:

- Payment button remains disabled because the frontend expects `postalCode` while the form submits `zipCode`.
- Backend returns a structured error that is visible in sandbox logs.
- The UI displays an ambiguous "Something went wrong" message.

The fixture should be local and deterministic so the demo does not depend on third-party websites, profiles, captchas, proxies, or external availability.

### 2. Browser agent

The model-driven agent receives the goal:

> Complete checkout for the test product, or identify and document the blocker.

It uses a restricted browser tool set:

- Navigate.
- Read page content.
- Inspect visible controls.
- Click.
- Type.
- Screenshot.
- Read console or page errors where available.

The browser session uses recording. A managed session created with `client.launch()` is finalized with `BrowserSession.close()` once, followed by closing the Solari client. A raw session created through `sessions.create()` uses `sessions.releaseAndWait(id)` instead. Never invoke both release paths for the same session.

### 3. Decision trace

At branches, retries, environment handoffs, and the final conclusion, the agent may emit a structured decision summary:

```ts
await run.decision({
  summary: "The payment button is disabled after the address form was submitted.",
  observation: "The page shows a complete address, but the payment control remains disabled.",
  nextAction: "Inspect browser errors and the network response before retrying.",
  evidence: [
    { operationId: "browser-action-17", artifactId: "screenshot-17" },
    { operationId: "browser-action-17", artifactId: "page-error-17" }
  ]
});
```

Lens shows expandable, agent-provided decision summaries linked to evidence. They are reported rationale, not independently verified accounts of internal reasoning. Omit uncalibrated confidence percentages; label missing evidence and distinguish observations from conclusions. Lens must remain useful when an agent emits no decision summaries.

The trace should distinguish:

- Agent goal.
- Action taken.
- Observation received.
- Decision summary.
- Evidence.
- Result.
- Next action.

### 4. Desktop confirmation

Use a desktop browser for a short, independent visual confirmation of the blocked checkout. Discover the installed browser at runtime, preferring a verified Chrome/Chromium executable and then Firefox. The desktop agent receives the task and run-specific fixture state, but not the seeded defect or diagnosis.

- Open the fixture directly at the relevant checkout state through its preview URL.
- Use the real model to inspect screenshots and choose two to five meaningful GUI actions.
- Use a fixed `1280x720` display and capture screenshots before and after actions.
- Stop after 10 GUI actions or 90 seconds.
- Record whether the payment control remains blocked and link the evidence to the same run.

Do not silently substitute scripted coordinates if model vision or desktop interaction fails. Report the stage as unsupported, failed, or incomplete. Desktop recording, embedded VNC, takeover, profiles, persistence, arbitrary applications, and multi-window workflows are excluded from the MVP.

### 5. Sandbox diagnosis

After browser and desktop stages complete, write a sanitized `evidence.json` into the fixture sandbox. The analyzer:

- Parses the browser evidence, desktop evidence, and fixture logs.
- Compares submitted field names against the expected schema.
- Produces a structured diagnosis.
- Writes `diagnosis.json` and `report.md`.
- Returns supporting evidence and explicitly identifies conclusions that remain uncertain.

The sandbox trace should show:

- Command.
- Exit code.
- stdout/stderr.
- Files created.
- CPU/memory/disk metrics.
- Final diagnosis.

A non-zero command exit code must be represented as an operation failure even when the API request itself returns HTTP `200`. Every diagnosis claim must reference at least one artifact or be labeled unsupported.

## Runtime and Model Provider

Implementation defaults: Node 22, TypeScript with ESM, React/Vite for the console-style UI, a local Node HTTP service, SQLite for history, and Server-Sent Events for live activity. These are Lens engineering choices; Solari does not prescribe a frontend or storage stack.

Start compatibility testing from the versions installed during prior tests: `@solarisdk/browser@0.1.3`, `@solarisdk/sandbox@0.1.2`, `@solarisdk/desktop@0.1.2`, and shared core `0.1.2`. Preserve exact dependency resolution in the lockfile and repeat relevant tests when changing versions. See [Solari TypeScript SDK](https://docs.getsolari.com/sdk/typescript).

The user has an **OpenCode Go subscription**. Use Go as the candidate model gateway for the real demo agent; this is not a direct OpenAI API credential. Solari supplies execution environments, Go supplies model inference, and Lens records the resulting activity.

Billing boundary: Solari credits pay for the Browser, Sandbox, and Desktop resources used by the run. OpenCode Go is a separate model-provider subscription with separate usage limits; Lens does not claim that model calls are included in Solari plans or create a second model-billing layer.

- Configure `OPENCODE_API_KEY` and `MODEL_NAME` in the local agent process. Keep the model adapter separate from Lens instrumentation so other users can instrument agents using different providers.
- Use the documented Go base URL `https://opencode.ai/zen/go/v1`; select the model-specific protocol and SDK adapter from the official endpoint table. Do not substitute the ordinary Zen endpoint or assume every model uses the same protocol.
- Identify the application with a specific user agent such as `solari-lens-demo/0.1` and send `x-opencode-session` using a stable, non-secret run identifier. Never use a Solari capability/session credential as this header.
- Keep the demo within Go's documented coding-agent-style usage and subscription allowances. Do not configure automatic paid fallback or change the account's billing settings.
- Before selecting a model, verify available model metadata, a complete tool-call/result loop, screenshot input grounded in visible content, and schema-validated decision summaries. A model listing alone is insufficient proof.
- Surface model quota exhaustion as an explicit run blocker. Preserve collected evidence and clean up owned Solari resources.

The exact model remains pending these tests. Do not claim model, vision, or tool-call compatibility until verified through this account. Reference: [OpenCode Go endpoints and usage requirements](https://opencode.ai/docs/go/).

## Lens SDK

Implement a focused TypeScript package around the agent's tool-execution boundary:

```ts
const lens = new Lens({
  projectId: "checkout-demo",
  storage: "local",
  tracer: optionalHostTracer
});

const run = await lens.startRun({
  name: "checkout-investigation",
  attributes: { model: process.env.MODEL_NAME }
});

await run.executeTool({
  environment: "browser",
  tool: "click",
  input: { role: "button", name: "Pay" },
  execute: () => page.getByRole("button", { name: "Pay" }).click()
});

await run.decision({
  summary: "The payment control is disabled after address submission.",
  nextAction: "inspect-errors",
  evidence: [{ operationId: "browser-action-17", artifactId: "screenshot-17" }]
});

await run.end({
  executionStatus: "completed",
  taskOutcome: "blocked",
  diagnosis: "confirmed",
  cleanupStatus: "succeeded"
});
```

### Integration contract

`run.executeTool()` is the canonical integration boundary. It records timing, status, redacted input/output summaries, model/tool correlation, evidence, and errors while preserving the wrapped operation's return value and exception. `run.step()`, `run.decision()`, and `run.artifact()` provide workflow annotations.

Provide narrow Browser, Sandbox, and Desktop adapters built on `executeTool()` for the exact methods used by the demo. These adapters normalize Solari-specific semantics such as sandbox exit codes, screenshot artifacts, replay state, and resource cleanup. Do not proxy arbitrary SDK clients, Playwright objects, pages, locators, or callbacks in v1.

Each run owns its event and trace context. Concurrent operations retain the correct parent. Decision annotations are optional. Instrumentation must preserve return values, exceptions, and application ownership of sessions even when persistence, SSE, or telemetry delivery fails.

### Supported adapter operations

- Browser: managed session lifecycle, navigation, visible observations, click/type actions, screenshots, page errors, failed requests, and replay finalization state.
- Sandbox: create/connect/kill, preview creation, foreground/background commands, file write/read, bounded stdout/stderr, and a small number of metrics samples.
- Desktop: create/connect/health/kill, screenshots, mouse and keyboard actions, and shell commands used by preflight.

Lens cannot observe tools that bypass `executeTool()` or an adapter. SDK-wide transparent wrapping, sandbox PTY/code/file-watch/Git/snapshots/volumes, desktop stream embedding, and arbitrary desktop applications remain future work.

### Event and telemetry model

SQLite is the canonical append-only run, event, and artifact index. Every event has a server-assigned monotonic sequence used for display ordering and SSE resume through `Last-Event-ID`. Product evidence links use operation and artifact IDs, not span IDs.

Every event records its event ID, sequence, run and operation IDs, optional parent operation ID, source and received timestamps, environment, provenance, type, status, summary, redacted attributes, and artifact IDs. Provenance is `observed`, `agent-reported`, `derived`, or `operator`. Artifact state is `pending`, `ready`, `capture-failed`, `invalid`, `expired`, or `unsupported`.

Use stable OpenTelemetry span names for the demonstrated operations:

- `solari.run`
- `solari.model.invoke`
- `solari.browser.navigate`
- `solari.browser.action`
- `solari.browser.replay.finalize`
- `solari.sandbox.command`
- `solari.sandbox.file`
- `solari.sandbox.metrics`
- `solari.desktop.gui`
- `solari.desktop.screenshot`
- `solari.desktop.command`

Lens uses the OpenTelemetry JavaScript API with an optional tracer supplied by the host. The demo initializes its provider before loading Lens; the Lens library does not replace global telemetry configuration. OpenTelemetry failure never interrupts agent execution. External OTLP collector integration remains future work. Reference: [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/).

Send operation-start, observation, and completion events through SSE as soon as they are appended. Store artifact IDs in events and telemetry, never credential-bearing provider URLs or raw SDK objects.

## Dashboard

### Run list

Show:

- Run name.
- Status.
- Duration.
- Environment types.
- Decision count.
- Failure count.
- Artifact availability.

### Live run

Live visibility is day-one functionality for every prototype user. Stream operation starts, completions, observations, and errors to the dashboard using Server-Sent Events with reconnect and event deduplication. Show current action, elapsed time, last observed progress, and explicit waiting or terminal status. Stale telemetry means progress is unknown, not proof the agent is stuck.

Actions and results lead the view. Decision summaries are expandable; resource metrics are secondary diagnostics. Do not depend on the observer WebSocket for the live timeline. Interactive takeover is a separate future capability.

### Run detail

Use a two-pane run inspector: a concise chronological story on the left and the selected evidence on the right. Keep investigation, checkout, environment-stage, and cleanup outcomes visible in a sticky header. Raw spans, retries, lifecycle operations, and metrics remain behind a technical-details toggle.

Display this chronological trace:

```text
Goal
  Sandbox fixture
    Start checkout application
    Verify preview content
  Browser session
    Navigate
    Observe checkout form
    Agent-reported rationale
    Click payment
    Failure
  Desktop confirmation
    Open failing checkout state
    Inspect screenshot
    Confirm visible failure
  Sandbox diagnosis
    Ingest sanitized evidence
    Compare schema
    Generate report
Final diagnosis
Cleanup result
```

Each decision expands to:

- Summary.
- Observation.
- Provenance.
- Next action.
- Evidence links.
- Result.

### Evidence panel

Support:

- Browser screenshot.
- Page error.
- Browser replay when finalized and validated.
- Sandbox stdout/stderr.
- Sandbox metrics.
- Generated report.
- Desktop screenshot.

Do not ingest or proxy full video or desktop streams in the MVP. Never persist signed replay, preview, file-download, or desktop stream URLs as ordinary metadata because the token is the credential. Screenshots and recordings use synthetic data and remain excluded from public export until marked `reviewed-for-sharing`.

### Day-one business signals

Include these practical product signals in the prototype without creating separate Lens accounts or billing:

- Named run history with status, duration, environment types, and failure reason.
- Project and run metadata such as `project`, `workflow`, `model`, `environment`, and `version`.
- Sanitized Markdown and JSON/JSONL export for sharing a run with a teammate or attaching it to an issue.
- Usage visibility showing session duration, artifact count, and sandbox CPU/memory/disk metrics.
- Fixed local cleanup of Lens-owned temporary artifacts; configurable retention UI remains future work.
- Optional host-configured OpenTelemetry emission plus readable JSON/JSONL export; full external collector integration remains future work.
- Use the user's Solari API key locally for resource access; native organization UI and billing integration remain documented placeholders. A local project label is not an authorization boundary.

## Explicit Exclusions and Reasons

### Raw chain-of-thought

Excluded because hidden token-level reasoning is not a reliable or safe product contract. It is replaced with concise decision summaries tied to evidence.

### Profiles and authenticated websites

Excluded because profiles contain cookies and local storage and can act as real logged-in accounts. They introduce credential handling and privacy risk without improving the core QA demo.

### Stealth, proxies, and captchas

Excluded because the demo uses a local deterministic application. They add plan dependencies, cost, and policy complexity without contributing to the debugging narrative.

### Undocumented observer frames as the source of truth

Excluded from the canonical trace because Solari does not guarantee the observer frame schema. Lens uses `executeTool()` events as authoritative and treats the observer stream as a possible future enhancement.

### Full snapshot, volume, PTY, code-interpreter, file-watch, and Git support

Excluded because they do not help the selected checkout-debugging story. They remain possible future adapters for coding-agent and long-running-workflow products.

### Generic hosted SaaS and billing

Excluded from the submission implementation because Lens is a Solari feature, not a separate SaaS product. Hosted infrastructure, account management, payment flows, and subscription enforcement remain documented future packaging placeholders.

### Multi-model evaluation

Excluded because comparing models is a separate product direction. The first demo should prove that one real agent can be understood and debugged.

### AI-generated postmortem summaries

Excluded from the first implementation. The sandbox should produce a deterministic diagnosis from captured evidence. A later version can add an LLM summarizer, clearly labeling generated conclusions separately from observed facts.

## Future Business Packaging

This is proposed packaging for a feature within Solari, not confirmed Solari policy or implemented billing. Solari charges resource usage through the supplied account key; Lens has no verified native identity or billing integration.

- **Free hypothesis:** current/recent visibility, failure evidence, optional decision annotations, and local sanitized export.
- **Starter hypothesis:** hosted history and basic organization sharing.
- **Professional hypothesis:** longer history, alerts, comparisons, failure clustering, and higher operational scale.
- **Enterprise hypothesis:** custom storage, access controls, auditability, export controls, and contract-specific deployment requirements. Make no compliance or region claims without implementation and review.

Solari currently provides browser replay retention of 1/7/30/90 days across Free, Starter, Professional, and Enterprise. These values may inform future Lens packaging, but they are not implemented Lens retention guarantees. Validate willingness to use and pay before finalizing Lens tiers, quotas, or storage charges. Local metadata cannot extend availability of provider-hosted artifacts. Show expired or unavailable evidence honestly and measure ingestion, storage, and support costs during pilots.

## Reliability Rules

Implement Solari-specific behavior directly:

- Non-zero command exit codes are failures even when HTTP returns `200`.
- Let the official SDKs apply their documented retries; do not add another automatic retry layer around SDK calls.
- For direct HTTP only, retry documented transient failures when the operation is idempotent.
- Do not retry concurrency `429` responses.
- Use idempotency keys only on routes that document them; do not assume every create route shares this contract.
- Finalize managed browser sessions with `BrowserSession.close()` and raw sessions with `sessions.releaseAndWait(id)`, never both.
- Treat temporary replay `404`s as pending finalization.
- Explicitly destroy demo-owned sessions in cleanup paths and verify their state. Instrumentation does not destroy user-owned sessions without an explicit lifecycle call. A local timeout does not cancel a remote operation; reconcile resources before reporting cleanup complete.
- Never treat a live stream URL or signed replay URL as ordinary metadata.
- Never serialize SDK handles.

### Outcomes, limits, and artifacts

- Separate execution status, checkout outcome, investigation outcome, diagnosis status, each environment-stage status, and cleanup status. A recovered action failure does not automatically fail the run. Investigating a broken checkout can succeed even though checkout itself failed. Loss of the runner leaves the investigation incomplete.
- Use `completed|failed|incomplete` for execution, `succeeded|blocked|failed` for checkout, `succeeded|failed|unsupported|cleanup-pending` for each environment stage, `confirmed|supported|inconclusive` for diagnosis, and `succeeded|partial|failed` for cleanup.
- Demo defaults: 40 tool calls and five minutes of execution per run, then a separate 60-second cleanup/reconciliation window. Bound each remote operation and model request by the remaining execution budget. If cleanup cannot be confirmed, retain a cleanup-pending record rather than claim success.
- The desktop stage has its own limit of 10 GUI actions or 90 seconds.
- Cap captured stdout/stderr at 64 KiB per operation and mark truncation. Limit demo-owned active resources to one browser, one sandbox, and one desktop; gracefully report account entitlement or concurrency blockers.
- Solari idle timeouts are rolling windows, not execution deadlines. Status reads and open connections may keep sessions alive. Stop observation when a run ends and poll metrics only while the associated workflow is active. See [Sandbox API](https://docs.getsolari.com/api-reference/sandboxes).
- For recorded browser sessions, finalize through the correct lifecycle path, poll replay availability for up to 30 seconds, download the response, and validate each NDJSON event before rendering playback. Handle HTTP decompression correctly rather than blindly gunzipping already decoded bytes. Test a visible action sequence in the replay player; a URL or line count is insufficient.
- Store replay state separately as pending, ready, unavailable, expired, or invalid; recording failures must not rewrite the task outcome. Recordings can contain form values, so the distributable sample uses only reviewed synthetic data. See [Solari recording](https://docs.getsolari.com/recording).
- Redact secrets, capability URLs, headers, logs, environment values, query credentials, and textual tool inputs before persistence, SSE, or OpenTelemetry emission. Recorded actions show what was attempted; screenshots and observations are required to verify visible effects.

## Delivery Phases

### Phase 1: Public proof

- One self-contained `examples/solari-lens-ts` implementation in a public Solari Cookbook fork.
- `demo:sample`, `doctor`, and `demo:live` commands.
- TypeScript `executeTool()` boundary and narrow Browser, Sandbox, and Desktop adapters.
- SQLite event/artifact index and local two-pane dashboard.
- Live run streaming and failure evidence as the primary experience.
- One real model-driven workflow in which Browser discovers the failure, Desktop confirms it visually, and Sandbox produces the final diagnosis.
- Optional decision annotations, provenance labels, separate outcomes, capture-time redaction, and sanitized Markdown/JSON/JSONL export.
- Host-configured OpenTelemetry emission for demonstrated operations.
- One genuine sanitized three-environment sample requiring no credentials.
- Three consecutive successful fresh runs with confirmed cleanup before making the full cross-environment claim.
- Public GitHub repository, focused video, and honest known limitations.

### Phase 2: Future Starter packaging

- Hosted ingestion.
- Server-side artifact authorization.
- Hosted history subject to product approval and measured storage costs.
- Basic workspace sharing through Solari organizations.

### Phase 3: Future Professional packaging

- OTLP export.
- Hosted team workflows and alert integrations.
- Cross-run analytics.
- Decision comparison across retries/models.
- Observer stream adapter.
- Configurable redaction and retention.
- Native organization, access-control, and billing integration.

## Testing

### Unit tests

- Event and optional span parent/child relationships.
- Decision event validation.
- Capture-time redaction before SQLite, SSE, and OpenTelemetry.
- Error/status mapping.
- Replay polling.
- Artifact expiry handling.
- Cleanup behavior.
- OTel serialization.
- Recovered action failure versus final task outcome, model quota failures, and incomplete runs.
- Execution budgets, output truncation, and cleanup-pending state.
- `executeTool()` return/error parity, concurrent run isolation, and bounded telemetry failure handling.
- Live stream reconnect/deduplication and accurate incomplete-run status.
- Sanitized exports excluding credentials and capability URLs; screenshots require explicit review before sharing.
- Cleanup removes only Lens-owned temporary artifacts and reports unavailable provider artifacts.

### Local end-to-end tests

- Start the fixture application.
- Verify actual preview content from both browser and desktop.
- Run the browser agent.
- Inject the known checkout defect.
- Confirm screenshot and action evidence; replay availability and rendering remain non-blocking.
- Run the bounded model-driven desktop confirmation and verify visible state changes.
- Write sanitized evidence into the sandbox, run the deterministic analyzer, and read `diagnosis.json` and `report.md`.
- Verify the final trace contains all three environment types.
- Verify separate checkout, investigation, stage, diagnosis, and cleanup outcomes.
- Verify `demo:sample` works from a fresh clone without credentials.

## Usefulness Validation and First Users

Primary audience: developers already building agents on Solari. Demand is a hypothesis; do not claim product-market fit from capability tests or a polished demo.

Before external feedback, run the real demo agent against one healthy fixture and one controlled field-schema failure. Do not reveal the enabled defect to the person inspecting the run. Compare diagnosis using ordinary logs with diagnosis using Lens and report prior knowledge if an independent reviewer is unavailable. Additional failure variants follow only after the primary submission is stable.

Record time to diagnosis, correctness, missing evidence, and whether someone else can understand the exported report. Publish actual results, including failures. This evaluates usability and instrumentation coverage, not market demand.

Use the public submission to recruit initial testers. Include a short integration example and an invitation for Solari developers to bring one failed run. Prepare an X post and a Discord introduction; publishing and contacting people require explicit authorization. Seek five initial testers without making their availability a release blocker.

Track first successful integration, first useful diagnosis, export usefulness, and voluntary return for a later run. Collect feedback by consent. Use repeat use and actual debugging needs to prioritize future coverage and paid packaging.

Acceptance: a developer can instrument their own supported agent, see live activity, understand a failure from its evidence, and export a sanitized report another developer can interpret. Internal testing is the initial proxy until external users try it.

### Solari integration tests

- Browser deliberate failure, screenshots, correct lifecycle finalization, and optional replay finalization.
- Sandbox preview content, command failure with stdout/stderr, file write/read, bounded metrics, and evidence transfer.
- Desktop entitlement, create/connect/health, installed browser discovery, preview content, screenshot interpretation, keyboard/mouse state change, and cleanup.
- Concurrent fixture sandbox and desktop capacity.
- Explicit cleanup after success, stage failure, quota failure, and model failure.

### Model and release gates

- `npm run doctor` verifies the rotated Solari key, browser/sandbox/desktop creation, concurrent fixture-sandbox and desktop capacity, actual preview content, desktop readiness and installed browser, screenshot state changes, model tool/vision compatibility, and cleanup without printing secrets.
- Live execution requires Solari Starter or equivalent capacity because the fixture sandbox and desktop overlap; report insufficient capacity before starting the run.
- Verify OpenCode Go authentication without printing credentials, then validate model tool calling, image input, decision-output schemas, and quota handling.
- Retrieve actual fixture content through the preview URL from the cloud browser and desktop; URL generation alone is not a pass.
- Verify nonblank screenshot content and model-driven GUI interaction before advertising desktop support.
- Treat replay playback as optional; advertise it only after real events parse and visibly render.
- Require `doctor` to pass and three consecutive fresh live runs to produce all three environment stages with confirmed cleanup.
- Test fresh-clone sample setup and bundle a sanitized genuine run so reviewers can inspect Lens without credentials; clearly distinguish sample viewing from live execution.

Use short timeouts, safe local data, idempotency keys, and sanitized logging.

## Public Submission

The repository should include:

- A public fork of `https://github.com/solari-sdk/solari-cookbook/` with one self-contained `examples/solari-lens-ts` submission.
- `npm run demo:sample`, `npm run doctor`, and `npm run demo:live`.
- A concise README with the supported `executeTool()` integration contract.
- Architecture diagram.
- Credential-free sample setup and documented live prerequisites.
- Required environment variables.
- A focused 60-90 second demo video.
- A short GIF or screenshots for the social post.
- Test results and known limitations.
- A section titled "Why this is useful."
- A README-only business hypothesis aligned with Solari's existing plans without claiming implemented billing or Lens retention.

The social post should lead with the visible outcome:

> I built Solari Lens, a proposed visibility feature for Solari agents. One agent encountered a checkout failure across Solari Browser, Sandbox, and Desktop. Lens turned its actions, observations, reported rationale, screenshots, runtime logs, and diagnosis into one evidence-linked timeline. Inspect the sample without credentials or run it live with your own Solari account.

Prepare the required X submission tagging `@harrychow_` and `@getsolari`, linking the public cookbook fork and demonstration. Prepare a Solari Discord introduction to recruit testers. Do not claim the prototype is an officially shipped Solari feature.

The demo video should show the failed action first, then the linked browser evidence, desktop confirmation, sandbox diagnosis, and cleanup result. It should not lead with architecture or pricing.

## Confirmed Direction and Open Decisions

- Confirmed: a real model-driven agent, one main demo using all three environments, and Lens positioned as a proposed Solari feature.
- Confirmed provider access: OpenCode Go subscription. Exact model and account-level tool/vision compatibility remain pending validation.
- Engineering defaults: Node 22/TypeScript ESM, React/Vite, Node HTTP service, append-only SQLite events, SSE, and optional host-configured OpenTelemetry emission. Previously installed Solari versions remain the initial test baseline.
- Integration contract: `executeTool()` plus narrow Browser, Sandbox, and Desktop adapters. Transparent SDK-wide wrappers are deferred.
- Desktop task: bounded independent visual confirmation from a run-specific checkout state. Browser executable, preview access, model vision, GUI state change, and cleanup remain live-test gates.
- The model receives only the declared tool schemas and workflow context.
- Decision summaries are explicit structured outputs, not hidden chain-of-thought.
- The controlled fixture runs in a Solari sandbox and is reached through its preview URL; laptop localhost is not directly reachable from a cloud browser. Preview content access needs validation before the demo depends on it.
- The full cross-environment public claim requires `doctor` to pass, three consecutive successful fresh runs, confirmed cleanup, and one genuine reviewed sample.
- Hosted packaging, configurable retention, and native console/account integration are future proposals. Existing 1/7/30/90-day values describe Solari browser replay retention, not implemented Lens retention. Day-one usefulness is tested locally; external demand remains unvalidated.
- The API key used during testing should be rotated before development because diagnostic output accidentally exposed credential-bearing SDK state.
