# Proposing a face in SVG before writing Monkey C

A Monkey C iteration is a build, a simulator launch, a screenshot and a look:
minutes. An SVG iteration is a file write: seconds. Every visual decision that
can be made in SVG should be made there, because the ones that reach Monkey C
get made once and then defended.

The failures this prevents are the expensive ones -- a subdial layout that turns
out to be unreadable, a status row that collides with the index band, a digit
cell too small for the stroke inside it. All of those survive a green test suite
and only show up in a capture.

## The rule that makes a mock worth anything

**An SVG mock must be constrained to what the panel can draw, or it is a lie.**

A browser gives you 16.7 million colours, alpha, gradients, blur and free
anti-aliasing. A fenix MIP panel gives you 64 colours on a 4x4x4 lattice, no
alpha blending at all, and no anti-aliasing. A mock that uses the browser's
extras gets approved and then cannot be implemented, and the gap is discovered
after the geometry is already committed.

`scripts/ciq-mock` exists to close that gap: it renders each proposal with every
colour quantised to the lattice, inside the round bezel, and lists what will not
survive.

```bash
<skill-dir>/scripts/ciq-mock /tmp/proposals.html a.svg b.svg c.svg --device fenix6pro
```

Then **open it and look at it**, the same way you would a simulator capture.

## What to write, and what not to

| Use | Not |
| --- | --- |
| `<rect>` `<circle>` `<line>` `<polygon>` `<path>` | `<image>`, `<pattern>` |
| flat `fill` on the lattice | `<linearGradient>`, `<radialGradient>` |
| `stroke-width` 2 or more | hairlines; a 1px diagonal is a dotted line |
| solid colour to separate shapes | `opacity` / `fill-opacity` of any kind |
| `<g transform="rotate(...)">` for hands | anything you cannot express as sin/cos |
| `<text>` as a *placeholder* | `<text>` as a measurement |

`<path>` is fine to draw with, but nothing in Monkey C consumes one: it has to
become `fillPolygon`, `drawArc` or `drawLine`. If a shape cannot be decomposed
into those, it is not a shape you can ship.

`<text>` deserves its own warning. Browser font metrics are not device font
metrics and never will be. Use text to reserve *approximate* space, then derive
the real box from `dc.getFontHeight()` and `dc.getTextWidthInPixels()` at draw
time. See `layout.md`.

## The lattice

`0x00 / 0x55 / 0xAA / 0xFF` per channel. Write colours on it directly and the
mock and the watch agree. Write anything else and `ciq-mock` will tell you what
it becomes -- usually a bigger jump than expected, and two carefully separated
greys frequently collapse onto one.

Rank by luminance, not by hue: on a transflective panel brightness *is*
reflectance. See `display.md`.

## The bezel

`ciq-mock` checks the farthest point of every `rect`, `circle`, `ellipse`,
`line`, `polygon` and `polyline` against the glass radius. It does **not** check
`<path>` shapes -- that needs a real path renderer and remains unchecked -- and
it does not validate text extents (font metrics come from the device, not the
browser).

The check that matters most is the rectangle one: a rectangle inscribed in a
circle fails at its **corners** long before its sides, and the amount by which
it fails is `sqrt(w^2 + h^2)/2`, not `w/2`. Radial markers have the same
problem: a marker of width `w` ending at radius `r` actually reaches
`sqrt(r^2 + (w/2)^2)`.

## Proposing to a human

Exactly three variants, not one and not seven. One is an ultimatum; seven is a survey.

Make the three differ on **one axis you actually want an answer about** --
information density, or dial polarity, or analog versus digital -- and hold
everything else constant. Variants that differ in five ways at once produce
"I like bits of each", which is not a decision.

State what is fixed by the device (resolution, colour count, no alpha) so the
feedback lands on choices rather than constraints, and say plainly that colours
shown are post-quantisation.

## After approval

Freeze the chosen variant into constants before writing drawing code: every
radius, every centre, every width, as named values in `Layout.mc`. The SVG is a
picture; `Layout.mc` is the specification, and keeping it free of `Dc` calls is
what makes the geometry unit-testable.

Then re-derive the mock from those constants if you change them. A stale mock
that no longer matches the code is worse than none, because it is what the human
remembers approving.
