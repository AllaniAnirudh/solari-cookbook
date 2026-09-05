# Implementation Audit

The prototype is not submission-ready. Prior completed live runs do not prove the release gates: several had incomplete Desktop stages, budget-limited Browser assessments, and predetermined diagnoses. No three-consecutive-run release claim is justified.

## Independent Review

Harvey reviewed the implementation against PLAN.md and DECISION_TREE.md without live API calls.

1. Replace the predetermined diagnosis with analysis of actual fixture logs, request schema, and linked Browser/Desktop evidence.
2. Derive outcomes from verified stage results; incomplete stages cannot become confirmed success.
3. Replace the synthetic sample with a reviewed genuine capture and record three qualifying fresh runs.
4. Normalize command exit codes through narrow adapters.
5. Enforce run/action/cleanup deadlines and persist cleanup verification.
6. Implement real doctor compatibility checks rather than configuration presence checks.
7. Preserve operation results and exceptions even if instrumentation persistence fails.
8. Redact all text surfaces and implement reviewed exports; desktop screenshots can contain preview credentials in browser chrome.
9. Fix SSE reconnect, cursor handling, and duplicate history delivery.

## Corrections Started

- Live orchestration no longer declares a confirmed root cause merely because its functions returned.
- Browser and Desktop assessments return their completion state.
- The sandbox report inventories actual artifact IDs and explicitly lists missing analysis. It is not the final analyzer required by the plan.
- Completed local test dashboards were stopped.

## Root Cause Fixed In This Revision

The Browser and Desktop loops could continue after the model had produced prose or exhausted its useful actions. `requestFinish()` asked for a `finish` call but the OpenCode request still sent `tool_choice: "auto"`, so the provider was free to emit another click or type call. The model consequently repeated actions after the payment schema failure until the loop budget expired. `OpenCodeModel.complete()` now accepts an explicit tool choice and the terminal assessment path forces the single `finish` function.

The same revision makes terminal run outcomes immutable, recovers only runs with stale event activity, verifies Solari desktop and sandbox release state during the cleanup window, validates preview URL/token consistency, and records the actual desktop display size used for coordinate validation. These are implementation safeguards; they do not replace the required fresh-run release evidence.

## Required Next Work

Keep the original scope: real checkout defect, independent Desktop interaction with visible effect, evidence-driven analysis, genuine sample, working live UI, safe export, and release verification. Do not reduce action budgets or replace Desktop interaction with observation-only to pass the release gate. The next validation is one full doctor run, one fresh live run, and resource verification; do not treat repeated exploratory runs as evidence.

## Verification After Correction

- `npx tsc --noEmit`, `npm test`, and `git diff --check` pass; 27 tests pass.
- `npm run doctor` passes Solari key configuration, OpenCode Go configuration, Sandbox preview, Browser rendering, Desktop readiness, model vision, model-selected input, and verified Desktop/Sandbox cleanup.
- One fresh live run completed with `executionStatus: completed`, `taskOutcome: blocked`, `diagnosis: supported`, Browser/Desktop/Sandbox stages `succeeded`, and `cleanupStatus: succeeded`.
- The live run’s evidence explains the real fixture defect: the payment request submitted `zipCode` while the server requires `postalCode`. Desktop evidence independently records that the visible payment interaction produced no observable change; the analyzer reports this as a caveat, not a false blocker.
- A post-run Solari inventory returned zero remaining Sandbox or Desktop resources.

The three-consecutive-run gate and reviewed public sample are still intentionally open. The code path is corrected and verified once; the remaining work is release evidence and human review of the selected screenshots before export.
