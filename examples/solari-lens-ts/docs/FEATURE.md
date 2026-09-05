# Solari Lens

## One-Sentence Description

Lens is a proposed Solari feature that turns an agent run into a readable, evidence-linked record.

It is intended to help answer a simple question: why did the agent succeed, fail, or stop?

## Two Audiences

### Developers And End Users

They use Lens to understand one run:

- What the agent attempted.
- Where the workflow failed.
- What the user could see at that point.
- Which logs and screenshots support the explanation.
- Whether the run cleaned up its Solari resources.

### Solari And Customer Engineering Teams

Across many runs, the same data can show:

- Repeated application or tool failures.
- Agents taking unnecessary actions.
- Slow Browser, Sandbox, or Desktop stages.
- Cleanup failures and wasted resource time.
- Regressions in agent or platform reliability.

Those cross-run views are the business direction, not part of this local prototype. The prototype proves that a single run can be captured and explained without hiding uncertainty.

## How It Was Built

AI was used for the code, tests, and documentation. OpenCode Go runs the model-driven Browser and Desktop steps. Three subagent reviews independently examined the model loop, Desktop handoff, and lifecycle and cleanup paths. Their findings were verified with local checks and one live Solari run.

## What The Example Does

The checkout app is a controlled test fixture, not the product. It runs in a Solari Sandbox and has a deliberate schema defect: the payment request submits `zipCode`, while the server requires `postalCode`.

The run proceeds through:

1. Sandbox fixture and sanitized request log.
2. Browser investigation with screenshots.
3. Independent Desktop observation of the payment state.
4. Sandbox analysis of the request log and evidence index.
5. Lens timeline, assessment, diagnosis, and cleanup result.

This sequence shows how Lens can be reused for another agent task without changing the core event and evidence model.

## What Gets Recorded

Lens records tool starts, completions, errors, observations, artifacts, assessments, stage outcomes, diagnosis, and cleanup. Every artifact is associated with its run, environment, and producing operation.

Provenance is explicit:

- `observed`: returned by a tool or Solari operation.
- `agent-reported`: a concise model assessment.
- `derived`: produced by the deterministic analyzer.
- `operator`: added by the runtime or a human.

The dashboard shows the timeline first. Technical details can be expanded when someone needs to inspect an operation or artifact.

## What It Does Not Record

Lens does not collect or display raw chain of thought. It records only short, structured summaries that the model chooses to report. These summaries are not treated as proof of hidden reasoning.

The terminal assessment request forces the `finish` function. This prevents a model from continuing to click or type after the useful evidence has been collected.

## Safety Rules

- Redact secrets, headers, capability URLs, preview tokens, and sensitive text before persistence or export.
- Keep screenshots and text artifacts local until a person marks them for sharing.
- Exclude unreviewed artifact content from exports while preserving its evidence reference.
- Treat a missing artifact or request as a limitation, not as a reason to invent a conclusion.
- Confirm remote Desktop and Sandbox cleanup before reporting it as successful.

## Day-One Feature

The first useful version should contain:

- Live timeline and run history.
- Failure, diagnosis, stage, and cleanup outcomes.
- Evidence links for screenshots, logs, and reports.
- Concise assessments with provenance labels.
- Redacted Markdown and JSONL export.
- Basic duration, action, artifact, and resource metrics.

Lens should be included in Solari's existing platform and plan structure rather than become a separate billing product. A future packaging model could add team sharing, hosted retention, cross-run search, efficiency analytics, alerts, and enterprise controls. Those are product hypotheses until validated with actual Solari users.

Solari resource credits and OpenCode model usage remain separate. This example does not claim that model calls are included in a Solari plan.

## Intentionally Out Of Scope

- Raw chain of thought.
- Authenticated browser profiles.
- Stealth, proxies, and CAPTCHA handling.
- Undocumented observer frames as the source of truth.
- Transparent wrappers for every Solari SDK object.
- PTY, snapshots, volumes, Git, and arbitrary desktop applications.
- Hosted Lens billing or a second organization system.
- Multi-model comparison.

These exclusions keep the first feature focused on explaining a run and avoid adding security, policy, and account-management problems before the core workflow is useful.

## Current Proof

The local type check and 27 tests pass. The live doctor has passed preview access, Browser rendering, Desktop readiness, model vision, visible Desktop input, and cleanup.

One live run completed with a blocked checkout and supported diagnosis. It found the `zipCode` versus `postalCode` mismatch, recorded independent Desktop visual evidence, and left zero Sandbox or Desktop sessions behind.

The remaining release work is three consecutive fresh live runs and a human-reviewed, credential-free sample.
