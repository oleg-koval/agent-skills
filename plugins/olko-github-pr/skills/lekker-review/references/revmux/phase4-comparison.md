# Phase 4: revmux engine on real PRs

One row per live `--engine revmux` run. Numbers come from revmux `stats` via
`scripts/revmux-adapter.mjs`; USD is the `pricing.json` list-price placeholder
(`verified: false`, output price applied to every token, synth+verify unpriced),
and every run so far went through the Max subscription, so USD is a relative
signal only. "Confirmed" means the main loop kept the finding after reading the
worktree; "merged" means two revmux findings described one mechanism.

| Date | PR | Depth | Wall | Tokens | USD est. | revmux findings | Kept | Re-severity | Hard-rule re-promotions | Merged | False positives |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-09 | evi-integrations #544 | medium (auto) | 15m40s | 12,604,506 | $169.53 | 4 | 3 (1 C / 2 I) + obs | 1 important → critical (lost role grants, watermark written before post-pass) | 0 | 0 | 0 |
| 2026-09-09 | evi-integrations #537 | deep (auto, *.sql) | 11m08s | 11,245,064 | $141.61 | 4 | 3 (0 C / 2 I / 1 idiomatic) + obs | none | 0 | 1 (#1 reactivation + #4 guard removal → one Important) | 0 |

## Notes per run

### #544

- revmux under-rated the watermark ordering bug as important; the main loop
  raised it to Critical after tracing `executeSyncStrategy` writing the CUSTOMER
  watermark before the role post-pass.
- One finding referenced `getShopFlag`, which does not exist in this repo;
  rewritten to an env toggle with Reflag as the policy target. Class: fix code
  invented from another repo's helper. Worth a lens note.
- Depth medium, so verify ran on Criticals only; revmux's own verify stage
  covered all four.

### #537

- Two of four findings were the same mechanism seen from two lenses (bugs,
  adversarial). Synthesis did not merge them; the main loop did.
- All four confirmed against the worktree. The idiomatic one (comment
  narrating deleted code) is exactly the teifi-conventions §2 class.
- Reactivation and soft-delete files are outside the diff, so the main
  finding could only be anchored on the sync-path signal it replaces.

## Still open

- Same PRs through the default `workflow` engine for a side-by-side (Oleg-driven).
- Read-only enforcement: revmux default `--tools` includes Bash; prompt-enforced
  only. `--tools=Read,Grep,Glob,WebFetch,WebSearch` override not yet applied.
- Adapter: price synth + verify once revmux reports a per-model split.
