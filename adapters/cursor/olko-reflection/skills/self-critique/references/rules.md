# Turning a critique into a durable rule (Step 5 detail)

A score is a measurement, not an improvement. The improvement is the rule you write down, in a
place a future session actually reads, before you move on.

## Write the shape, not the incident

The incident is the evidence; the shape is the rule. Ask what class of reasoning produced the
error, then name that class:

| Incident | Shape worth keeping |
| --- | --- |
| Called an endpoint a read because the path was a noun and a sibling module imported | A conclusion drawn from evidence that does not cover the claim |
| Priced an open design question as "small" in the same sentence that asked which design was wanted | Never attach a size to an answer you are simultaneously asking for |
| Described a batch from the one member that was checked | Check the risk-deciding field on every member before describing the set |

Broadening a rule's scope so it qualifies for a wider store is the failure mode to avoid: one
incident on one afternoon is not standing policy. Let the evidence decide where it lands.

## Routing, in order, only one store

1. The user's or project's agent memory: how to work with this user or this project.
2. The repository's own `CLAUDE.md` / `AGENTS.md`: true only inside that codebase.
3. A shared, cross-session store: holds across projects. Use `context-repo` to resolve it, or
   `shared-knowledge-artifact` when several agents need to read the same ledger.

Before writing to shared persistence, redact the incident evidence, including when using
`context-repo` or `shared-knowledge-artifact`, while still including the incident and its dated
receipt. This does not apply to local agent memory or repository-rule writes.

## Dedupe

Read the store first. If a rule of the same shape exists, add one dated evidence line to it instead
of creating a second entry, with at most three evidence lines per rule. A fourth incident means the
rule named the incident, not the shape: rewrite the rule text and keep the three most recent
evidence lines. Link related rules instead of restating them. When the memory directory exists, run
`node <skill>/scripts/rule-store.mjs evidence-check --dir <memory dir>` before writing and report
any rule it flags.

## Identity and counters

Mark each rule stored by this workflow with `rule_store: self-critique` under `metadata:` in its
memory file's frontmatter. The replay pass reads only marked rules, and only marked rules are
pruning candidates. `fire` adds the marker itself, so a rule that has fired is always both counted
and prunable. A rule's `fires` and `last_fired` live under `metadata:` and are written only by
`fire`. Rules routed to `CLAUDE.md`, `AGENTS.md`, or the shared store are neither counted nor pruned.

Older rules may have a `fires` counter and no marker (counted, never prunable).
`node <skill>/scripts/rule-store.mjs adopt --dir <memory dir>` marks them. It edits memory files,
so tell the user before running it.

`rule-store.mjs checklist --dir <dir> --scope all` lists every named memory file, marked or not.
Use it only to find an unmarked rule that belongs to this workflow.

## Prune pass

At the end of Step 5, only when a valid memory directory is available, run
`node <skill>/scripts/rule-store.mjs prune --dir <memory dir> --idle-days 60` and list the
candidates in the report under "Rules proposed for deletion". Never delete a rule without the
user's reply.

## Close the loop

State in your report where the rule was written and what it says, so the user can veto it. A rule
the user has not seen is a rule they cannot correct. The honest test is not that a rule was written
but that the next task of the same class does not need this skill to catch the same thing. If it
does, the rule named the incident instead of the shape: rewrite it, do not add another.
