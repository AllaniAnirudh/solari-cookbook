# Implementation Audit

This file separates what is implemented and verified from what is still a release requirement.

## Verified

- `run.executeTool()` records redacted operation events without changing the wrapped result or exception.
- Browser, Sandbox, and Desktop adapters are limited to the operations used by the demo.
- SQLite stores runs, events, and artifacts. Evidence references are checked against run ownership and producing operations.
- The dashboard shows task, diagnosis, stage, and cleanup outcomes separately.
- SSE reconnects from `Last-Event-ID` and avoids duplicate events.
- Unreviewed artifact content is excluded from Markdown and JSONL export.
- Terminal assessments use the `finish` schema and stage-owned screenshots.
- The forced `finish` request prevents the model from continuing actions after the useful work or action budget is over.
- Terminal run outcomes cannot be overwritten. Stale-run recovery marks interrupted runs incomplete without rewriting active runs.
- Solari Desktop and Sandbox cleanup are verified through remote state before cleanup is reported as successful.
- Preview URL and access-token consistency is checked without persisting the token.

## Live Verification

Local verification passed:

- `npx tsc --noEmit`
- `npm test` with 27 passing tests
- `git diff --check`

The live doctor passed API configuration, OpenCode Go configuration, Sandbox preview, Browser rendering, Desktop readiness, browser discovery, model screenshot interpretation, visible input, and resource cleanup.

One fresh live run completed with:

```text
executionStatus: completed
taskOutcome: blocked
diagnosis: supported
browser: succeeded
desktop: succeeded
sandbox: succeeded
cleanupStatus: succeeded
```

The run identified the fixture defect from its sanitized request log: payment submitted `zipCode`, while the server requires `postalCode`. The Desktop agent independently recorded that its visible payment click produced no change. The analyzer kept that as a caveat because no Desktop payment request was recorded.

The post-run Solari inventory contained zero Sandbox or Desktop resources.

## Root Cause Of The Earlier Loop

The model loop asked the provider for a `finish` call but sent `tool_choice: "auto"`. The provider could therefore return another click or type call, and the Browser agent repeated actions after the payment error until its loop limit.

The model adapter now accepts an explicit tool choice. The terminal assessment path forces the `finish` function, and a regression test checks the outgoing request body.

## Still Open

- Run three fresh live runs consecutively with confirmed cleanup.
- Human-review the selected screenshots and bundle one genuine sanitized run for `demo:sample`.
- Add hosted aggregation, organization views, and efficiency analytics only after real users validate the single-run workflow.
- Add OpenTelemetry and browser replay only when their provider contracts and output rendering are verified.

Until these items are complete, the project should be described as a proposed Solari feature with one verified live demonstration, not as a shipped product.
