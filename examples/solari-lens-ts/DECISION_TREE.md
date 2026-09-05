# Solari Lens Decision Tree

This document records the decisions behind the prototype and the checks required before presenting it as a complete cross-environment feature.

## 1. What Are We Building?

```text
Is Lens a separate product?
  No -> It is a proposed feature inside Solari.

Is checkout the product?
  No -> Checkout is only the proof scenario.

What is the feature?
  A run timeline that connects agent actions, environment results,
  evidence, diagnosis, and cleanup.
```

The first user is a developer or operator trying to understand one run. The longer-term customer is also a Solari or engineering team looking across runs for recurring failures, wasted actions, slow environments, and efficiency improvements.

## 2. Reviewer Entry Point

```text
Can the reviewer see the feature without credentials?
  No -> Fix demo:sample before submission.
  Yes -> Continue.

Does the live path need cloud access?
  Yes -> Run doctor before demo:live.
```

Commands:

- `npm run demo:sample`: opens illustrative local data without credentials.
- `npm run doctor`: checks temporary Browser, Sandbox, Desktop, preview, model, input, and cleanup paths.
- `npm run demo:live`: runs the real model-driven workflow.
- `npm test`: runs local tests.

## 3. Preflight

```text
Is SOLARI_API_KEY and OpenCode Go configured?
  No -> Stop and show the missing setup item.

Can the account create a Browser, Sandbox, and Desktop at once?
  No -> Stop and report the capacity requirement.

Does Sandbox preview return the expected fixture?
  No -> Stop; the cloud environments cannot share the run.

Can Browser render the fixture?
  No -> Stop; report Browser unsupported.

Can Desktop become ready, display a nonblank screenshot,
and respond to model-selected input?
  No -> Stop; report Desktop unsupported.

Are all doctor resources confirmed gone after cleanup?
  No -> Stop; do not start the live demo.

All pass -> Run one live workflow.
```

The doctor must not print API keys, preview tokens, signed URLs, or other capability-bearing values.

## 4. Workflow

```text
Sandbox starts the deterministic checkout fixture
  -> verify preview content
  -> Browser agent attempts checkout
  -> Desktop agent independently checks the visible payment state
  -> Sandbox analyzes sanitized logs and evidence
  -> Lens stores diagnosis and cleanup outcome
```

The Browser and Desktop agents receive the task and run-specific URL. The Desktop agent does not receive the Browser assessment or the seeded defect.

The fixture defect is deliberately narrow: the server requires `postalCode`, but the payment request contains `zipCode`. The UI returns a generic payment error. This gives the reviewer a failure that is easy to follow without involving a third-party site, account, CAPTCHA, or real payment data.

## 5. Evidence Rules

```text
Does an agent make a claim?
  Yes -> Require a structured assessment and stage-owned screenshot IDs.

Is the claim from a model?
  Yes -> Label it agent-reported.

Is it from the fixture analyzer?
  Yes -> Label it derived.

Is the artifact not reviewed?
  Yes -> Keep its content out of public export.

Is a screenshot or request missing?
  Yes -> Show the limitation; do not fill it with a synthetic claim.
```

Lens records concise reported assessments, not raw chain of thought. When a model has no useful next action, the terminal request forces the `finish` function. This prevents the repeated-action failure that was found during live testing.

## 6. Outcome Rules

Keep these values independent:

- Execution: `completed`, `failed`, `incomplete`.
- Task: `succeeded`, `blocked`, `failed`.
- Diagnosis: `confirmed`, `supported`, `inconclusive`.
- Stage: `succeeded`, `failed`, `unsupported`, `incomplete`, `cleanup-pending`.
- Cleanup: `succeeded`, `partial`, `failed`.

```text
Checkout blocked + investigation completed
  -> Valid result. The agent can successfully explain a failed task.

Diagnosis has a caveat but no evidence blocker
  -> Keep diagnosis supported and show the caveat separately.

Runner stops or a stage times out
  -> Mark execution incomplete and preserve collected evidence.

Remote cleanup cannot be verified
  -> Mark cleanup partial and affected stages cleanup-pending.
```

Terminal runs are immutable. A second process only recovers a run after its event activity is stale, so it cannot overwrite an active run.

## 7. Business Boundary

Day one should include the signals a developer can act on immediately:

- Current run timeline.
- Failure reason and supporting evidence.
- Stage and cleanup status.
- Action count, duration, artifact count, and basic resource metrics.
- Sanitized Markdown and JSONL export.

Future Solari or organization views can add cross-run failure clustering, action-efficiency comparisons, retention, alerts, collaboration, and policy controls. Those should use Solari's existing identity, organization, and billing model. This prototype does not invent plan flags, billing screens, or Lens accounts.

Solari resource credits and OpenCode model usage are separate. The demo does not claim that model calls are included in a Solari plan.

## 8. Exclusions

- Raw chain of thought: not safe or stable as a product contract.
- Authenticated profiles: introduce cookies, local storage, privacy, and account risk.
- Stealth, proxies, and CAPTCHA handling: unrelated to the debugging proof.
- Undocumented observer frames: not a stable canonical event source.
- Broad SDK wrappers: too much compatibility surface for day one.
- PTY, snapshots, volumes, Git, and arbitrary desktop apps: future adapters only.
- Hosted billing and organization management: future integration with Solari.
- Multi-model comparison: separate product direction.

## 9. Release Gate

```text
Does demo:sample work from a clean clone without credentials?
  No -> Submission blocked.

Does doctor pass?
  No -> Submission blocked.

Do three fresh live runs complete all three stages?
  No -> Do not claim complete cross-environment support.

Does each run confirm cleanup with zero owned resources left behind?
  No -> Submission blocked.

Is one real run sanitized and human-reviewed?
  No -> Submission blocked.

Do README, screenshots, video, and social copy describe only verified behavior?
  No -> Correct the claims.
  Yes -> Ready to submit.
```

Current state: the doctor and one complete live run pass. The three-run gate and reviewed public sample remain open.

## 10. Submission

The video and social post should show the result in this order:

1. Payment attempt and generic error.
2. Browser action and screenshot evidence.
3. Independent Desktop confirmation.
4. Sandbox diagnosis and caveats.
5. Cleanup result.

Describe Lens as a proposed Solari feature. Link the public Cookbook fork and tag `@harrychow_` and `@getsolari`.
