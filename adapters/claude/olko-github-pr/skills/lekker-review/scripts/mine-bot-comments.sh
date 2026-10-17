#!/usr/bin/env bash
# Mine real Greptile / Gemini review comments from a repo's merged PR history
# and cluster them into the patterns worth pre-empting.
#
# Why this exists: predicting bot-reviewer comments from a model's intuition is
# guesswork. The bots have already told us what they comment on - dozens of
# times, in this exact repo, on this exact codebase. Mining that is free and it
# is evidence, not a guess.
#
# Usage:
#   mine-bot-comments.sh <repo-slug> [out-md] [--limit N]
#
#   repo-slug   e.g. acme/web-app
#   out-md      default: $LEKKER_DATA_DIR/bot-patterns.md, where LEKKER_DATA_DIR
#               defaults to ~/.cache/lekker-review (outside the skill dir, so a
#               plugin update does not wipe the mined history)
#   --limit N   max review comments to fetch, newest first (default 400);
#               paging stops there, so a long history is never pulled whole
#
# Writes/replaces a "## <repo-slug>" section in out-md, leaving other repos'
# sections alone, and prints a one-line summary. The section carries a
# "<!-- mined: YYYY-MM-DD -->" marker that SKILL.md reads to decide staleness;
# a repo with no bot comments still gets a section, so it is not re-mined on
# every run.

set -uo pipefail

REPO_SLUG="${1:-}"
if [[ -z "$REPO_SLUG" ]]; then
    echo "usage: mine-bot-comments.sh <repo-slug> [out-md] [--limit N]" >&2
    exit 2
fi
shift

DATA_DIR="${LEKKER_DATA_DIR:-$HOME/.cache/lekker-review}"
OUT_MD="$DATA_DIR/bot-patterns.md"
LIMIT=400

while [[ $# -gt 0 ]]; do
    case "$1" in
        --limit) LIMIT="${2:-400}"; shift 2 ;;
        *)       OUT_MD="$1"; shift ;;
    esac
done

mkdir -p "$(dirname "$OUT_MD")"

python3 - "$REPO_SLUG" "$OUT_MD" "$LIMIT" <<'PYEOF'
import datetime, json, os, re, subprocess, sys
from collections import defaultdict

repo_slug, out_md, limit = sys.argv[1:4]
limit = int(limit)

# Review comments are the inline ones - the class the bots actually bill for.
# Page by hand rather than `gh api --paginate`, which fetches the whole history
# before LIMIT could apply.
comments = []
page = 1
while len(comments) < limit:
    res = subprocess.run(
        ["gh", "api", "repos/%s/pulls/comments?per_page=100&sort=created&direction=desc&page=%d"
         % (repo_slug, page)],
        capture_output=True, text=True)
    if res.returncode != 0:
        print("mine-bot-comments: gh api failed for %s (auth? repo name?)" % repo_slug, file=sys.stderr)
        sys.exit(1)
    batch = json.loads(res.stdout or "[]")
    if not isinstance(batch, list):
        break
    comments.extend(batch)
    if len(batch) < 100:
        break
    page += 1
comments = comments[:limit]

BOT_RE = re.compile(r'gemini-code-assist|greptile|coderabbit', re.I)


def is_bot(c):
    return bool(BOT_RE.search((c.get("user") or {}).get("login", "")))


bot_comments = [c for c in comments if is_bot(c)]


def first_claim(body):
    """The sentence that carries the finding, with the bot's chrome removed."""
    text = body or ""
    # Both bots lead with chrome: Gemini an image badge, Greptile an <a><img>
    # priority pill. Neither is the claim.
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    text = re.sub(r'<[^>]+>', ' ', text)
    # Fenced code is the suggestion, not the claim.
    text = re.sub(r'```.*?```', ' ', text, flags=re.S)
    text = re.sub(r'`[^`]*`', ' CODE ', text)
    text = re.sub(r'^\s*[#>*\-]+\s*', '', text, flags=re.M)
    text = re.sub(r'\s+', ' ', text).strip()
    parts = re.split(r'(?<=[.!?])\s', text)
    for p in parts:
        if len(p.strip()) > 25:
            return p.strip()[:400]
    return text[:400]


STOP = set("""a an and are as at be been but by can could does for from has have if in into is it
its may not of on or should that the their them there these this to was were will with would you your
we i be his her they code line file change changes when which what while also""".split())


def signature(claim):
    words = re.findall(r'[a-z]+', claim.lower())
    words = [w for w in words if len(w) > 3 and w not in STOP]
    # The 6 rarest-feeling words are a good enough fingerprint at this scale;
    # sorted so wording order does not split one pattern into two clusters.
    return tuple(sorted(set(words))[:6])


# A curated taxonomy on top of the free-text clustering. Fingerprint clustering
# splits one concern across several wordings ("casting violates policy", "the use
# of CODE is a type cast", "TypeScript casts bypass checks" are one comment the
# bots make three ways), and the CATEGORY is what a reviewer can act on before
# the bot ever runs.
CATEGORIES = [
    ("type cast / any",        r'\btype (cast|assertion)|\bcasting\b|\bas unknown\b|\bany\b type|\bnon-null assertion'),
    ("null / undefined guard", r'\bnull\b|\bundefined\b|optional chain|\bmissing (a )?check'),
    ("error handling",         r'\berror (handling|is swallowed)|silently (fail|ignor)|catch block|\bthrow\b|unhandled'),
    ("pagination",             r'\bpaginat|\bpageInfo\b|\bhasNextPage\b|\bcursor\b|page size'),
    ("await / concurrency",    r'\bawait\b|floating promise|not awaited|\brace\b|concurren|fire.and.forget'),
    ("unused / dead code",     r'\bunused\b|not used|dead code|\bunreachable\b|never referenced'),
    ("debug / logging",        r'\bconsole\.|debug(ging)? (statement|log)|log(ging)? (noise|level)|should be removed before'),
    ("hardcoded / magic value",r'\bhardcoded\b|magic (number|string)|should be (a )?constant|configurable'),
    ("naming",                 r'\bnaming\b|\brename\b|\bmisleading name|the name CODE'),
    ("comment / docs",         r'\bcomment (is|does|adds)|\bredundant comment|\bjsdoc\b|\btypo\b'),
    ("test coverage",          r'\btest (coverage|case)|\bnot (covered|tested)|missing (a )?test'),
    ("performance / N+1",      r'\bN\+1\b|\bin a loop\b|inefficien|\bperformance\b|every (run|iteration)|batch'),
    ("schedule / config",      r'\bcron\b|\bschedul|\benv (var|variable)|\byaml\b|\bvalues\.'),
    ("SQL / query",            r'\bSQL\b|\bquery uses\b|\bwhere clause\b|\bindex\b|\btransaction\b'),
]


def categorize(body):
    text = body or ""
    hits = [name for name, rx in CATEGORIES if re.search(rx, text, re.I)]
    return hits or ["other"]


PRIORITY_RE = re.compile(r'badges/(p[0-9])\.svg|\b(P[0-9])\b')


def priority(body):
    m = PRIORITY_RE.search(body or "")
    if not m:
        return None
    return (m.group(1) or m.group(2) or "").upper()


category_counts = defaultdict(int)
category_priority = defaultdict(list)
for c in bot_comments:
    prio = priority(c.get("body", ""))
    for name in categorize(c.get("body", "")):
        category_counts[name] += 1
        if prio:
            category_priority[name].append(prio)

clusters = defaultdict(list)
for c in bot_comments:
    claim = first_claim(c.get("body", ""))
    if not claim:
        continue
    clusters[signature(claim)].append((claim, c))

# Merge clusters that share most of their fingerprint - one pattern phrased two
# ways should not read as two patterns with a count of 1 each.
merged = []
for sig, items in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
    for m in merged:
        shared = len(set(sig) & set(m["sig"]))
        if sig and m["sig"] and shared / max(len(set(sig) | set(m["sig"])), 1) >= 0.5:
            m["items"].extend(items)
            break
    else:
        merged.append({"sig": sig, "items": list(items)})

merged.sort(key=lambda m: -len(m["items"]))

lines = []
lines.append("## %s" % repo_slug)
lines.append("<!-- mined: %s -->" % datetime.date.today().isoformat())
lines.append("")
if not bot_comments:
    lines.append("No bot review comments in the newest %d review comment(s)." % len(comments))
    lines.append("")
else:
    lines.append("Mined from %d bot review comment(s) (%s). Counts are how many times the "
                 "bots have raised that pattern in THIS repo - the higher the count, the more "
                 "certain it is to come back on the next PR."
                 % (len(bot_comments), ", ".join(sorted({(c.get("user") or {}).get("login", "?")
                                                         for c in bot_comments}))))
    lines.append("")
    lines.append("### Categories, most-raised first")
    lines.append("")
    lines.append("| times raised | category | typical priority |")
    lines.append("|---|---|---|")
    for name, count in sorted(category_counts.items(), key=lambda kv: -kv[1]):
        prios = category_priority.get(name, [])
        typical = min(prios) if prios else "-"
        lines.append("| %d | %s | %s |" % (count, name, typical))
    lines.append("")
    lines.append("A comment can land in more than one category, so the column sums above the")
    lines.append("comment total. Read the categories as priors: on a diff that touches one of")
    lines.append("them, assume the bots will raise it and settle it before opening the PR.")
    lines.append("")
    lines.append("### Concrete comments, most-repeated first")
    lines.append("")

    for m in merged:
        if len(m["items"]) < 2 and len(merged) > 12:
            continue
        claim, c = m["items"][0]
        count = len(m["items"])
        path = c.get("path") or "?"
        lines.append("- **x%d** - %s" % (count, claim))
        lines.append("  - e.g. `%s` ([comment](%s))" % (path, c.get("html_url", "")))

    lines.append("")

body = "\n".join(lines)

existing = ""
if os.path.exists(out_md):
    with open(out_md) as f:
        existing = f.read()

header = ("# Bot reviewer patterns\n\n"
          "What Greptile / Gemini / CodeRabbit have actually commented on, per repo, mined\n"
          "from review-comment history by `scripts/mine-bot-comments.sh`. This is evidence,\n"
          "not prediction: every line below is a comment a bot really left.\n\n"
          "Delivered to the review agents as `botPatternsFile`. Regenerate per repo with\n"
          "`scripts/mine-bot-comments.sh <repo-slug>`.\n\n")

if not existing.startswith("# Bot reviewer patterns"):
    existing = header + existing

# Replace this repo's section in place; leave every other repo alone.
pattern = re.compile(r'^## %s$.*?(?=^## |\Z)' % re.escape(repo_slug), re.M | re.S)
if pattern.search(existing):
    # A function replacement, so backslashes in mined bot text are literal.
    existing = pattern.sub(lambda _: body, existing)
else:
    existing = existing.rstrip() + "\n\n" + body

with open(out_md, "w") as f:
    f.write(existing)

print("mine-bot-comments: %d bot comment(s) -> %d pattern(s) -> %s"
      % (len(bot_comments), len(merged), out_md))
PYEOF
