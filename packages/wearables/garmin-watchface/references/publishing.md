# Publishing through the browser

`references/store.md` covers *what* the listing needs. This covers *driving the
portal*, which is the only way in — Garmin publishes no submission API.

Run `scripts/ciq-release` before opening a browser. Everything it checks is
something you would otherwise discover halfway through the form.

## The portal is automatable

The obvious conclusion is that it is not: `apps.garmin.com/developer/dashboard`
sits behind Garmin SSO *and* Cloudflare bot protection, and a headless browser
lands on a "Performing security verification" interstitial. That is what you see
if you navigate cold.

It works anyway, because the session is already sitting in your own browser.
Import the cookies:

```bash
B=~/.claude/skills/gstack/browse/dist/browse

$B cookie-import-browser comet --domain .garmin.com     # note the LEADING DOT
$B goto https://apps.garmin.com/                        # host-scoped cookies
$B cookie-import-browser comet --domain apps.garmin.com #   need you to be on
$B goto https://sso.garmin.com/                         #   the host first
$B cookie-import-browser comet --domain sso.garmin.com

$B goto https://apps.garmin.com/developer/dashboard     # no SSO redirect
```

Three separate traps in that block:

- **`garmin.com` imports nothing. `.garmin.com` imports everything.** The cookie
  is stored under the dotted domain and the filter is an exact match, so the
  obvious spelling silently returns `Imported 0 cookies` and looks like "not
  logged in".
- **Host-scoped cookies need you on that host first**, or the import refuses
  with *"does not match current page domain"*. The `.garmin.com` set alone is
  NOT enough to authenticate — the session only holds once
  `apps.` and `sso.` are imported too.
- **Substitute your browser.** `comet`, `chrome`, `brave`, `arc`, `edge`,
  `chromium` are supported. Whichever one you actually signed into.

Verify by checking the URL after `goto`: an unauthenticated session is bounced
to `sso.garmin.com/portal/sso/...`, an authenticated one stays put.

## "The Connect IQ store is currently in maintenance mode"

This string is in the DOM of the dashboard and of every app page, next to
*Upload New Version*, *Edit Details* and *Remove*. Reading the page text makes
it look like every action is blocked.

**It is pre-rendered hidden markup, not an active block.** Click the button and
the real form loads. Do not report the store as down on the strength of a text
dump — click first, then check for a *visible* dialog:

```bash
$B js "(function(){var o=[];document.querySelectorAll('[role=dialog],.modal').forEach(function(x){if(x.offsetParent!==null)o.push(x.innerText.slice(0,120))});return o.join('|')||'no visible modal'})()"
```

## The two-step update flow

*Upload New Version* → `/apps/<uuid>/update`, which is two steps.

**Step 1 — attach.** A file input and an *App Version* textbox. Publish stays
disabled until both are set; the page shows the current version so you can pick
the next one.

```bash
$B upload "input[type=file]" "$(pwd)/bin/<name>.iq"
$B fill @e43 "2.0"
$B click @e46                      # "Upload and publish"
```

On success the page reports **Status: Verified, Signature: Verified** and
expands the product list — a manifest naming one product can resolve to several
store devices (`fenix6pro` becomes fēnix 6 Pro, 6 Pro Dual Power, 6 Pro Solar
and quatix 6).

**Step 2 — details.** Title, description, What's New, images, category, contact
email. Ends in *Submit*.

The description arrives pre-filled with the copy from the PREVIOUS version.
After a redesign it describes a face that no longer exists, and nothing prompts
you about it. Re-paste from `docs/store/listing.md` every time.

## Image slots, in DOM order

There are seven `input[type=file]` elements and none of them carry a name, id
or label. Order is the only way to tell them apart, so confirm it before
uploading rather than trusting this table:

```bash
$B js "(function(){var f=document.querySelectorAll('input[type=file]');var o=[];f.forEach(function(x,i){var n=x,c='';for(var k=0;k<8&&n;k++){n=n.parentElement;if(n&&n.innerText.trim().length>25){c=n.innerText.replace(/\s+/g,' ').slice(0,60);break}}o.push(i+' >> '+c)});return o.join('\n')})()"
```

| # | Slot | Size | Limit |
| --- | --- | --- | --- |
| 0 | Hero image | **1440×720** | 2048 KB |
| 1 | Cover image | **500×500** | 300 KB |
| 2–6 | Screen images | any | **150 KB each** |

Getting the order wrong puts a 260px screenshot where the hero belongs, and the
form accepts it.

## The description validator

Two rejections, both discovered only after filling the entire form and pressing
Submit:

- `Illegal characters found: <, >.` — an ASCII `->` arrow is enough to trip it.
- `The app description is invalid. It should not contain emojis.` — **U+2699
  GEAR counts**, which is exactly the character you reach for when writing
  "tap the gear icon". U+2192 RIGHTWARDS ARROW passes today but lives in the
  same symbol space.

Write settings paths in words: *"Garmin Connect app, then: your device, Connect
IQ Apps, Watch Faces, <app>, settings"*. `scripts/ciq-release` checks the fenced
blocks of `listing.md` for both classes before you open a browser.

The error text renders as a leaf node with no `aria-invalid` anywhere, so find
it by scanning for childless visible elements rather than by form state:

```bash
$B js "(function(){var o=[];document.querySelectorAll('*').forEach(function(x){if(!x.children.length&&x.offsetParent!==null&&/invalid|illegal/i.test(x.innerText))o.push(x.innerText.trim())});return Array.from(new Set(o)).join(' || ')})()"
```

Success is a redirect to `apps.garmin.com/apps/<uuid>`. Staying on `/update`
means a validation failure.

## Things not to click

**Remove** sits between *Edit Details* and *Download* in the same button row.
Never target buttons by index in that row.

**Upload and publish** and **Submit** are outward-facing: they push to a public
listing and accept the Developer License Agreement on the account holder's
behalf. Confirm with the human before either, even when they have asked for the
release — version number and stale copy are both worth one question.

## Account state

A developer account pending identity verification can still upload; approval
gates public visibility, not submission. A newly submitted app sits in preview
mode, visible only to its owner, for up to three days.
