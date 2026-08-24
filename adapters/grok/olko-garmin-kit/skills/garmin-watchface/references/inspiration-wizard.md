# Wizard mode: from "make me a watch face" to a frozen spec

Use this when the brief is a mood rather than a design -- "something modern",
"like a chronograph", "match my brand". Do not use it when the user already
knows what they want; skip to `design-proposals.md`.

The wizard is five stages and **two** questions to the human. Stopping at every
stage for approval is how a design session becomes a survey; stopping at none is
how you build the wrong face beautifully.

The order below is the point. Constraints come before ideas, because the device
facts invalidate whole categories of idea and it is cheaper to lose them now.

---

## Stage 0 -- Constraints, before a single idea

```bash
<skill-dir>/scripts/ciq-doctor
<skill-dir>/scripts/ciq-devices --same-as <target>
```

Then read the target's `compiler.json` yourself and write down four numbers:

| Fact | Why it kills ideas |
| --- | --- |
| resolution + shape | the round bezel eliminates most rectangular layouts |
| `bitsPerPixel` | 8bpp is 64 colours; photographic anything is out |
| `alphaBlendingSupport` | almost always false: no translucency, no soft edges |
| `watchFace` memoryLimit | typically ~112 KB: vector only, no bitmap dial |

A face conceived without these gets redesigned after it is built.

---

## Stage 1 -- Gather

```bash
<skill-dir>/scripts/ciq-inspire --brand acme.com --json /tmp/tokens.json
<skill-dir>/scripts/ciq-inspire --image ~/crest.png
<skill-dir>/scripts/ciq-inspire --prior-art "chronograph"
```

Three axes worth gathering along:

- **Object** -- if there is a real watch or instrument behind the brief, its
  proportions and polarity are what make it recognisable. Get those first; see
  the homage section in `SKILL.md`.
- **Palette** -- from a brand domain, or from an image the user already owns.
  Everything comes back quantized, so what you show is what ships.
- **Prior art** -- read other people's Monkey C for *technique*, not for code.
  Most Connect IQ repositories carry no licence, which means all rights
  reserved.

**IP boundary.** Colours, proportions and layout ideas are fair to borrow. Names,
wordmarks and logos are not -- not in the face, the launcher icon, the
screenshots or the copy. `ciq-inspire --brand` will return another company's
logo without complaint; that is a research artefact, not an asset. See
`store.md`.

---

## Stage 2 -- Question one: the axis

Ask the human **one** question, with three or four concrete options, about the
axis you cannot infer. In practice it is nearly always one of:

| Axis | Options that actually differ |
| --- | --- |
| Form | analog hands / digital numerals / hybrid |
| Density | core metrics only / moderate / dense |
| Polarity | dark dial, bright ink / light dial, dark ink |
| Character | instrument, tactical, minimal, retro homage |

Alongside it, settle the boring-but-load-bearing ones in the same breath,
because each changes the code shape rather than the look:

- **Which devices.** One device is a manifest line; a second resolution is a
  second layout. Widening later is cheap only if you stayed vector-only.
- **Sweeping seconds.** This is a battery decision, not an aesthetic one. It
  forces `onPartialUpdate`, a 20 ms budget, clip-box arithmetic and an
  `onPowerBudgetExceeded` fallback ladder. Costs roughly a third of the build.
- **Settings.** Themes and toggles mean `properties.xml`, `settings.xml`, and
  the simulator's habit of ignoring changed defaults. Also: watch face settings
  are unreachable from the watch, only from the phone app -- if you add them,
  the listing has to say so or every user reports them missing.

---

## Stage 3 -- Diverge: three variants as SVG

Write three SVG files that differ on **the one axis you asked about**, holding
everything else constant. Then:

```bash
<skill-dir>/scripts/ciq-mock /tmp/proposals.html a.svg b.svg c.svg --device <target>
```

Read `design-proposals.md` before writing the SVG -- the constraints there are
what stop a mock promising something the panel cannot render. Open the HTML and
look at it yourself before showing anyone. Fix anything the audit flags; an
approved design with a bezel violation in it is a design that will be quietly
changed later.

Density is where these get decided in practice. The most-cited reason people
uninstall a fenix face is data crammed in too small to read -- so if the
variants differ in density, the dense one must be honestly dense, at real font
sizes, or the comparison is rigged.

---

## Stage 4 -- Question two: converge

Show the sheet. Ask which variant, and what to change about it. Expect the
answer to be "B, but with A's date placement" -- that is a good answer and it is
why the variants held everything else constant.

Do **one** revision round, re-run `ciq-mock`, and stop. A third round means the
axis in Stage 2 was the wrong one; go back and ask a better question rather than
iterating on pixels.

---

## Stage 5 -- Freeze

Turn the approved picture into a specification before writing drawing code:

- every radius, centre, width and offset as a named constant in `Layout.mc`
- the palette as **roles** (`DIAL`, `RULE`, `INDEX`, `HAND`, `ACCENT`), not as
  colour names, so a second theme is a table row rather than a rewrite
- the draw order, written down -- a later fill erases an earlier ring
- the two or three places where the layout is nearly out of room, with the
  remedy already chosen, so the fix later is not an ad-hoc nudge

Keep `Layout.mc` free of `Dc` calls. That is what lets the geometry be
unit-tested against the bezel across the full sweep, which is the only automated
check that catches a clipped layout.

Then, and only then, start Phase 0 of the build.
