# Solari Lens Feature

Solari Lens is a proposed native Solari capability for making agent runs understandable. It is a feature in the Solari workflow, not a separate product or hosted SaaS application.

## User Outcome

After a run, a user should be able to answer:

- What is the agent doing now?
- What happened when the task failed?
- Which evidence supports the conclusion?
- What remains uncertain?
- Were Solari resources released?

The dashboard presents this as a run history and evidence-linked timeline. It keeps the task result, investigation result, diagnosis, environment stages, and cleanup result separate.

## Demonstration Boundary

The checkout workflow is only the proof scenario. The Lens event model and adapters remain task-agnostic:

1. Sandbox hosts a deterministic fixture and records sanitized request evidence.
2. Browser performs a model-driven investigation and captures screenshots.
3. Desktop independently observes the same run-specific state and records visual evidence.
4. Sandbox analyzes the request log and evidence index.
5. Lens stores the timeline, artifacts, assessment provenance, diagnosis, and cleanup state.

The public Lens facade is `Lens`, `LensStore` is the local prototype persistence layer, and `executeTool()` is the instrumentation boundary. The Solari SDK objects are not proxied wholesale.

## Evidence Rules

- Raw chain of thought is not collected or displayed.
- Agent-reported summaries are labeled as agent-reported, not presented as hidden reasoning or verified facts.
- A terminal assessment must use the `finish` schema and reference stage-owned screenshots.
- When the agent must stop, the model request forces the single `finish` function so it cannot continue clicking or typing.
- Screenshots and text artifacts are retained locally until explicitly reviewed for sharing.
- Preview credentials, headers, tokens, and sensitive text are redacted before persistence or export.
- A supported diagnosis may include caveats. Caveats do not become blockers unless they prevent the evidence join.

## Run Outcomes

The dashboard distinguishes:

- Execution: `completed`, `failed`, or `incomplete`
- Task: `succeeded`, `blocked`, or `failed`
- Diagnosis: `confirmed`, `supported`, or `inconclusive`
- Stage: `succeeded`, `failed`, `unsupported`, `incomplete`, or `cleanup-pending`
- Cleanup: `succeeded`, `partial`, or `failed`

Terminal runs are immutable. Interrupted runs are recovered only after stale event activity, preventing a second process from overwriting an active run. Remote Desktop and Sandbox cleanup is not considered successful until Solari reports a terminal gone state or a definitive not-found response.

## Business Packaging

Lens should be packaged as an observability and debugging capability within Solari plans, not as a second billing system:

- Day one: local timeline, run history, redacted metadata, screenshots, evidence links, Markdown/JSONL export, and cleanup status.
- Team or paid tier candidate: shared retention, collaboration, searchable run history, and hosted export controls.
- Higher-tier candidate: longer retention, organization-wide diagnostics, richer replay integrations, and policy controls.

These tiers are product hypotheses, not current Solari entitlements. Solari execution credits and OpenCode model usage remain separate concerns. Lens does not bundle or resell model inference.

## Exclusions

The first feature version excludes raw chain of thought, authenticated user profiles, stealth or CAPTCHA bypass, undocumented observer frames, broad SDK wrappers, hosted Lens billing, and multi-model orchestration. These exclusions reduce security and scope risk while preserving the user-visible value. Their future placeholders belong in the plan, not in the day-one runtime.

## Current Verification

The corrected implementation has passed the local type check and 27 tests. The live doctor passed Sandbox preview, Browser rendering, Desktop readiness, model vision, visible input change, and verified cleanup. One fresh live run completed with:

```text
executionStatus: completed
taskOutcome: blocked
diagnosis: supported
browser: succeeded
desktop: succeeded
sandbox: succeeded
cleanupStatus: succeeded
```

The genuine run identified the fixture defect: payment submitted `zipCode` while the server requires `postalCode`. The Desktop screenshot independently showed no visible result from the attempted payment interaction and is recorded as a caveat because it generated no matching server request. The post-run Solari inventory contained zero remaining Sandbox or Desktop resources.

The three-consecutive-run release gate and reviewed public sample remain open. See [`PLAN.md`](../PLAN.md), [`DECISION_TREE.md`](../DECISION_TREE.md), and [`IMPLEMENTATION_AUDIT.md`](../IMPLEMENTATION_AUDIT.md) for the complete delivery and submission criteria.
