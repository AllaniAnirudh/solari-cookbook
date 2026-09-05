# Solari Lens: Implementation Plan

## Status

This is a proposed Solari feature implemented as a public Cookbook example. The checkout app is a fixture used to demonstrate the feature; it is not the product.

The current code supports one local run, a live three-environment demo, evidence-linked assessments, a dashboard, and reviewed exports. The remaining release work is three fresh live runs and a human-reviewed credential-free sample.

## The Problem

An agent can fail even when the underlying Solari environments are working. A developer then has to reconstruct the failure from model messages, browser state, shell output, screenshots, and resource cleanup.

Lens puts that information in one run record. It answers three practical questions:

1. What did the agent do?
2. What happened when the task failed?
3. What evidence can I share with another person?

## Who Benefits

End users and developers need a clear explanation of one failed or slow run. They care about the action that failed, the visible result, the supporting evidence, and whether the run cleaned up correctly.

Solari teams and customer engineering teams can use the same signal across many runs to find recurring failures, unnecessary agent actions, slow environments, and reliability regressions. Cross-run aggregation and efficiency analytics are future hosted capabilities. They are not simulated in this example.

## How It Was Built

AI was used for the implementation, tests, and documentation. OpenCode Go is also the model provider used by the live Browser and Desktop agents. Three focused subagent reviews covered the Browser/model loop, the Desktop handoff, and lifecycle and cleanup behavior. The findings were checked with local tests, the doctor command, and a live Solari run.

## The Demonstration

The demo uses a small deterministic checkout fixture:

1. The Sandbox serves the application and records sanitized request logs.
2. A Browser agent attempts checkout with a restricted tool set.
3. A Desktop agent independently opens the run-specific payment state and checks the visible result.
4. The Sandbox analyzer compares the request log with the expected schema and joins the evidence.
5. Lens displays the run, assessments, diagnosis, caveats, and cleanup result.

The deliberate defect is simple: the payment request contains `zipCode`, but the server requires `postalCode`. The page shows only a generic payment error. This gives the reviewer a concrete failure to follow through all three environments.

The Desktop stage is independent. It does not receive the seeded cause or the Browser assessment. If it produces a screenshot without a matching server request, the analyzer records that as independent visual confirmation and a caveat.

## What Is Implemented

### Lens boundary

`run.executeTool()` wraps an actual agent or environment operation. It records a start event, completion or error event, redacted input and output summaries, and the run and operation IDs. It returns the original result or throws the original exception.

The public `Lens` facade creates project-scoped runs. `LensStore` is the local SQLite persistence layer. The three adapters cover only the Browser, Sandbox, and Desktop methods used by this demo.

```ts
const lens = new Lens({
  projectId: "checkout-demo",
  storage: "local"
});
const run = lens.startRun({ name: "checkout-investigation" });

await run.executeTool({
  environment: "browser",
  tool: "click",
  input: { role: "button", name: "Pay" },
  execute: () => page.getByRole("button", { name: "Pay" }).click()
});
```

### Events and evidence

Each event has a server-assigned sequence, run ID, operation ID, environment, provenance, status, summary, attributes, and artifact IDs. Artifact records include their producing operation, environment, media type, state, and hash.

Provenance values are:

- `observed`: returned by a tool or Solari operation.
- `agent-reported`: a concise model assessment.
- `derived`: produced by the deterministic analyzer.
- `operator`: added by the Lens runtime or a human.

The dashboard streams events over SSE and resumes from `Last-Event-ID`. Technical details remain expandable so the first view stays focused on the failure.

### Assessments

The model can submit a structured `finish` result with:

- `succeeded`, `blocked`, or `inconclusive` outcome.
- A short summary.
- Screenshot artifact IDs owned by that stage.

When a loop reaches its action limit or returns prose instead of an assessment, Lens makes a second model request with `tool_choice` forced to the `finish` function. This prevents repeated clicks or typing after the useful work is over.

### Outcome separation

Lens stores these separately:

- Execution: `completed`, `failed`, or `incomplete`.
- Task: `succeeded`, `blocked`, or `failed`.
- Diagnosis: `confirmed`, `supported`, or `inconclusive`.
- Stage: `succeeded`, `failed`, `unsupported`, `incomplete`, or `cleanup-pending`.
- Cleanup: `succeeded`, `partial`, or `failed`.

A blocked checkout can therefore have a successful investigation and a supported diagnosis. A lost runner remains incomplete. Terminal run outcomes cannot be overwritten, and stale-run recovery does not rewrite an active run.

## Safety And Privacy

- Raw chain of thought is not collected or displayed.
- Model assessments are labeled `agent-reported`; they are not presented as verified internal reasoning.
- Secrets, headers, capability URLs, preview tokens, and sensitive text are redacted at capture time.
- Screenshots and text artifacts remain local-only until explicitly reviewed for sharing.
- The export path removes unreviewed artifact content but keeps the evidence references.
- Lens destroys only sessions created by the current run. Cleanup is successful only after Solari reports a terminal state or a definitive not-found response.

## Day-One Product Scope

These are the parts that make sense in the first Lens release:

- A live timeline for one run.
- Run history with task, diagnosis, stage, and cleanup outcomes.
- Evidence links for screenshots, logs, and generated reports.
- Concise agent assessments with provenance labels.
- Redacted Markdown and JSONL export.
- Resource duration and basic environment metrics.
- Explicit cleanup status.

The first release should not add billing screens, a second account system, or a large SDK wrapper. The value is visible before those systems exist.

## Business Direction

Lens should strengthen Solari's existing platform and plans rather than become a separate subscription.

- Free or local use: current run visibility and sanitized export.
- Team or Starter direction: shared run history and basic collaboration.
- Professional direction: longer retention, failure search, comparisons, and efficiency reporting.
- Enterprise direction: access controls, audit history, export policy, and custom retention.

These are packaging hypotheses, not current Solari entitlements. Solari resource usage and OpenCode model usage remain separate. The example does not claim that model calls are included in a Solari plan.

The company-side value should be measured with real usage: time to first useful diagnosis, repeated failures, action count, environment duration, cleanup failures, and whether an exported run helps another engineer. Do not claim product-market fit from this demo alone.

## Deliberate Exclusions

- Raw chain of thought: unsafe and not a reliable product contract; use concise evidence-linked assessments.
- Authenticated profiles: cookies and local storage create privacy and account-safety risk.
- Stealth, proxies, and CAPTCHA handling: unrelated to the debugging proof and policy-heavy.
- Undocumented observer frames: not a stable canonical event source.
- Transparent SDK-wide wrappers: broad compatibility work with little day-one value.
- PTY, snapshots, volumes, Git, and arbitrary desktop applications: useful future adapters, not needed for this demo.
- Hosted Lens billing and organization management: should follow Solari's existing account model.
- Multi-model comparison: a separate product direction.

## Release Checklist

Before describing Lens as a complete cross-environment submission:

- `npm run demo:sample` works from a clean clone without credentials.
- `npm run doctor` passes the account, model, preview, Browser, Desktop, and cleanup checks.
- Three consecutive fresh live runs complete Browser, Desktop, and Sandbox stages.
- Each run confirms cleanup and leaves no owned Solari resources behind.
- One real run is reviewed, sanitized, and bundled for the credential-free sample.
- README, screenshots, video, and social copy describe only verified behavior.

Until those checks are complete, call Lens a proposed feature and call the sample illustrative.

## Submission

The submission should lead with the visible failure and the evidence trail:

1. Show the payment attempt and the generic error.
2. Show the Browser screenshots and request evidence.
3. Show the independent Desktop result.
4. Show the Sandbox diagnosis and its caveats.
5. Show cleanup as a separate result.

Link the public Cookbook fork and tag `@harrychow_` and `@getsolari` on X or LinkedIn. Do not present Lens as an officially shipped Solari feature.

See [Decision tree](DECISION_TREE.md) for go/no-go branches and [Feature overview](FEATURE.md) for the short product explanation.
