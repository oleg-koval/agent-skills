# Scoring reference

The score is `100` minus penalties, floored at 0. It is computed by
`node <skill>/scripts/claim-ledger.mjs score <ledger>`, never by hand and never by the critic.

## Penalties

| Finding | Points off |
| --- | --- |
| refuted, load-bearing | 25 |
| refuted | 10 |
| unverifiable, load-bearing | 10 |
| unverifiable | 4 |
| inferred, accepted, load-bearing | 10 |
| inferred, accepted | 5 |
| missed, load-bearing | 15 |
| missed | 5 |
| verified but found only by the critic | 5 |

An `inferred` missed item (`checked_by: inferred`) is never penalised. A non-load-bearing one is
not an open defect; a load-bearing one is, so it still blocks the stop rule until you verify it.

Why a load-bearing inferred claim costs 10: it used to cost 5, which made "inferred" cheaper than
"unverifiable" (10) for the same lack of evidence, so unverified claims drifted into the cheaper
bucket. Load-bearing means the user would act on it, so the two now cost the same.

The 5 points for "verified but found only by the critic" can never be revised away. That is why the
stop rule in `SKILL.md` does not use a score threshold.

## Score anchors

Calibrate against these three ledgers (all claims `origin: both`;
`node <skill>/scripts/claim-ledger.mjs anchors` prints them as JSON).

**Strong, score 95**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| a1 | no | inferred | inferred |

**Middling, score 72**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| b1 | no | refuted | read |
| b2 | no | refuted | read |
| b3 | no | unverifiable | read |
| b4 | no | unverifiable | read |

**Weak, score 40**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| c1 | yes | refuted | read |
| c2 | yes | refuted | read |
| c3 | yes | unverifiable | read |

## Ledger shape

`version` is always `1`. `author_id` and `critic_ref` let the script cross-check the ledger.

```json
{ "version": 1,
  "claims": [
    { "id": "c1", "text": "...", "load_bearing": true, "origin": "both",
      "author_id": "a1", "critic_ref": "r1:claims.0",
      "status": "verified", "checked_by": "command", "receipt": "quoted output" },
    { "id": "c2", "text": "...", "load_bearing": false, "origin": "critic",
      "critic_ref": "r1:claims.1", "status": "inferred", "checked_by": "inferred" }
  ],
  "missed": [
    { "id": "m1", "text": "...", "load_bearing": false, "checked_by": "read",
      "critic_ref": "r1:missed.0" }
  ] }
```

- `origin`: `author` | `critic` | `both`
- `author_id`: the id from `author-claims.json`. Required when `origin` is `author` or `both`;
  forbidden when it is `critic`.
- `critic_ref`: `"r<round>:claims.<index>"` or `"r<round>:missed.<index>"`, a string or an array,
  pointing into the saved `critic-r<round>.json`. Required when `origin` is `critic` or `both`, and
  on every `missed` entry; forbidden when `origin` is `author`.
- `status`: `verified` | `refuted` | `unverifiable` | `inferred`
- `checked_by`: `command` (run, output quoted) | `read` (file or record opened, quoted) |
  `inferred` (reasoning only). Required on `missed` items too. A `verified` or `refuted` claim may
  not use inferred evidence and requires a non-empty receipt.

## Integrity checks

When `--author`, `--critic` or `--prev` is passed, the script also fails (exit 2) on:

- a duplicate id;
- an author claim with no ledger entry, or a ledger claim naming an unknown author claim;
- a critic item (any round) with no ledger entry, or a `critic_ref` that points at nothing;
- a claim id from the previous ledger that is missing from the new one (a revision may add claims,
  never drop one).

Output carries `"integrity": "checked"` when any flag was given and `"unchecked"` otherwise. An
`unchecked` score is not a reportable score.
