---
description: cross-layer consistency: one business rule implemented twice must agree, row by row
---
## Lens: lekker-consistency

Review the change for **cross-layer consistency**: one business rule enforced in
more than one place, where the places disagree.

This is the defect class that survives every other lens. Each implementation is
correct read on its own, each has its own tests, and the bug only exists in the
gap between them. Nobody reads them side by side, so nobody sees it.

### Step 1: find the rules implemented more than once

A rule is duplicated when the same decision (allow/block, show/hide, include/
exclude, retry/fail) is made in two code paths that can both run for the same
input. The usual shapes:

- a client-side guard and the server-side validator behind it (a checkout UI
  extension and the Shopify Function, a form check and the API handler);
- a UI filter and the query that feeds it;
- a webhook handler and the cron reconciler that backfills the same state;
- a feature flag read in two clients that must agree on the same gate;
- a permission checked in a route guard and again in the service.

Search the worktree (`{{WORKDIR}}`), not only the diff. The second
implementation is very often a file this change never touched; that is exactly
how the two drift apart.

### Step 2: print the two decision tables side by side

For every duplicated rule, build the table before judging anything. One row per
input class, one column per implementation, cell = the decision that
implementation makes:

| Input | Layer A (`file:line`) | Layer B (`file:line`) |
|---|---|---|
| value present, active | allow | allow |
| value present, inactive | block | block |
| **value missing / undefined / empty** | **block** | **allow** |
| gate disabled | allow | allow |

Rows that must always appear, because they are where layers actually diverge:

- the missing / `undefined` / `null` / empty-string input;
- the not-applicable actor (a D2C shopper where the rule is B2B, an
  unauthenticated caller, a shop with no config);
- the gate or feature flag being off;
- the error path (one layer fails open, the other fails closed).

Put the real table in the finding. A reader who cannot see both columns cannot
check your claim, and the table is the whole evidence.

### Step 3: judge the divergence

Any row where the two columns differ is a finding. Severity:

- **critical**: the strict layer is the one that can be bypassed, or the
  divergence blocks a legitimate action (a user who should be able to check out
  cannot) or admits one that should be blocked.
- **major**: the layers disagree but the authoritative layer is still correct,
  so the visible effect is a confusing or wrong message rather than a wrong
  outcome.

Name which layer is authoritative and say so explicitly: the server-side,
unbypassable one is the specification, and the advisory client-side one must
match it. **A client layer that is STRICTER than the server is still a bug**, and
the easy one to wave through, because it looks like extra safety. It is not: it
blocks work the system allows, and the person hitting it has no way around a
rule the server would have permitted.

Also compare both tables against the acceptance criteria in `{{CONTEXT}}`. When
an AC governs the same decision and one layer disagrees with it, quote the AC
verbatim in the finding. When the AC and a scoping decision in `{{CONTEXT}}`
disagree with each other, report that as its own finding, quote both, and do not
pick a side; that contradiction is the author's call to make.
