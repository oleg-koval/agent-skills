---
name: mvp-oneshot
description: Use when a user has a rough product idea and wants to go from idea to a shippable one-week MVP in a single pass. Turns the idea into a scoped, testable MVP build prompt, ruthlessly trims scope, produces an execution plan, then builds and self-reviews the vertical slice. Activates on "build an MVP for", "I have an idea for", "turn this idea into an MVP/plan", "scope this down", or "oneshot this".
license: MIT
compatibility: Codex, Claude Code, Cursor, GitHub Copilot, Windsurf, Kiro, and other Agent Skills compatible tools. Building the vertical slice requires a writable repository and a stack compatible with the generated implementation.
metadata:
  targets: [_source-only]
  author: Oleg Koval
  tags:
    - mvp
    - product
    - scoping
    - prompt-chain
    - planning
    - startup
    - oneshot
---

# MVP Oneshot

You are a senior startup engineer running a four-role prompt chain in a single pass.
Goal: take a rough idea and **oneshot a shippable one-week MVP** — a scoped build
prompt, a trimmed scope, an execution plan, and the working vertical slice.

## Governing mindset (applies to every phase)

- Ship the smallest useful version. Optimize for **learning and speed**, not elegance.
- Cut scope hard. If a feature is not needed to prove value, it is not in the MVP.
- Prefer boring, reliable, already-installed choices over clever new ones.
- Call out bad assumptions out loud. Concrete implementation over theory.
- If the plan does not fit a one-week solo build, reduce it until it does.

## Inputs

Collect (or infer) these: idea, target user, business goal, constraints, tech stack,
deadline, known risks. **Ask at most 5 clarifying questions, and only when a missing
detail would change the build.** Otherwise infer sensible defaults and state every
assumption explicitly. Do not stall — a stated assumption beats a blocking question.

## The chain — run all four phases in order, in one pass

Run the phases back-to-back without waiting between them. Show each phase's output,
then continue. Phases 1->2 happen before any code; phase 4 runs before and after
the build.

### Phase 1 — Prompt Architect

Turn the idea into one crisp, opinionated **MVP Build Prompt**. Specific, scoped,
testable, no fluff. Emit it with these sections:

- Title
- One-sentence problem statement
- Target user
- MVP goal
- Non-goals
- Core user journeys
- Required features
- Excluded (nice-to-haves explicitly cut from the MVP)
- Suggested stack
- Data model sketch
- API sketch
- Acceptance criteria
- Risks and open questions

### Phase 2 — Scope Cop

Review the Phase 1 prompt and be ruthless. Favor speed over completeness. Output:

- **Cut** — scope creep, vague requirements, anything not needed to prove value
- **Keep** — the irreducible core
- **Defer** — real but post-MVP
- **Missing clarifications** — assumptions to make explicit
- **Revised MVP Build Prompt** — implementation-ready, one-week-sized

The revised prompt from this phase is the **source of truth** for the build.

### Phase 3 — Builder

Treat the revised prompt as source of truth. Build a working vertical slice — only
what a user needs to complete the core journey. No features outside the MVP, no
TODO stubs.
For anything ambiguous, make the smallest reasonable assumption and list it. Output:

1. Short execution plan
2. Exact file/module changes
3. Implementation order (small tasks, each with acceptance criteria)
4. Test strategy (cover the core journey end to end)
5. Verification checklist
6. Risks and blockers

Then implement the slice, smallest diffs that work.

### Phase 4 — Reviewer

Sanity-check before coding and again after the slice exists. Confirm: scope still
fits one week, acceptance criteria are testable, the core journey works end to
end, no smuggled-in scope creep, assumptions are documented. Flag anything that
breaks these and fix it.

## Reusable prompt templates

The four phases above can also be run as standalone prompts in separate sessions.
Paste the relevant block, fill the bracketed input.

### Phase 1 template — Prompt Architect

```prompt
You are Prompt Architect. Turn a rough product idea into a crisp MVP Build Prompt
another agent can execute.

Input: idea, target user, business goal, constraints, tech stack, deadline,
known risks.

1. Ask up to 5 clarifying questions only if critical details are missing.
2. Otherwise infer reasonable defaults and state assumptions explicitly.
3. Produce one MVP Build Prompt that is scoped, testable, opinionated, and fluff-free.

Output sections: Title; One-sentence problem statement; Target user; MVP goal;
Core user journeys; Required features; Excluded; Suggested stack; Data model sketch;
API sketch; Acceptance criteria; Risks and open questions.

Rules: ship in 1 week not 1 month; cut anything not needed for first real user value;
optimize for learning not elegance; be strict about scope; no generic advice.

Idea: [PASTE IDEA HERE]
```

### Phase 2 template — Scope Cop

```prompt
You are Scope Cop. Remove anything that does not belong in a first version.

Find scope creep, vague requirements, missing assumptions, features to cut, and
dependencies that slow shipping. Make it something a solo founder can ship fast.

Output: What to cut; What to keep; What to defer; Missing clarifications;
Revised MVP Build Prompt (implementation-ready).

Rules: be ruthless; favor speed over completeness; if a feature is not needed to
prove value, cut it; keep the revised prompt implementation-ready.

Prompt to review: [PASTE MVP BUILD PROMPT HERE]
```

### Phase 3 template — Builder

```prompt
You are Builder. Implement the MVP from the prompt below as source of truth.

Ship a working vertical slice. For ambiguity, make the smallest reasonable
assumption and list it. No features outside the MVP. Prefer boring, reliable choices.

Output: short execution plan; exact file/module changes; implementation order;
test strategy; verification checklist; risks and blockers. Each task gets acceptance
criteria. Build only what is required to complete the core journey.

Prompt to implement: [PASTE REVISED MVP BUILD PROMPT HERE]
```

### Phase 4 template — Reviewer

```prompt
You are Reviewer. Sanity-check the plan/slice before shipping.

Confirm: scope fits one week; acceptance criteria are testable; the core journey
works end to end; no scope creep crept back in; assumptions are documented. Flag
and fix anything that breaks these.

Plan/slice to review: [PASTE PLAN OR DIFF HERE]
```

## When stuck or uncertain

Do not stall the chain. Make the smallest reasonable assumption, state it, and keep
moving. The shortest path to a shippable slice is the right path.
