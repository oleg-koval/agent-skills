# Layout

Monkey C will happily draw at y=400 on a 260px screen. Nothing warns you; the
pixels just do not exist. Almost every layout bug in this skill's history is a
constant that was written down instead of measured.

## Measure, never assume, font heights

Real heights on fenix 6 Pro. They are larger than they look:

| Font | Height |
| --- | --- |
| `FONT_XTINY` | 19 |
| `FONT_TINY` | 29 |
| `FONT_SMALL` | 32 |
| `FONT_NUMBER_MEDIUM` | 74 |

`FONT_NUMBER_MEDIUM` at 74px means a two-line time block is **148px of a 260px
face** — 57% of the screen for four digits.

These differ per device, so treat the table as an order-of-magnitude guide and
call `dc.getFontHeight()` at draw time.

To measure on a device you have not used, drop a `System.println` into
`onUpdate`, build, push, and read `monkeydo`'s stdout:

```monkeyc
System.println("H xtiny=" + dc.getFontHeight(Graphics.FONT_XTINY)
    + " small=" + dc.getFontHeight(Graphics.FONT_SMALL)
    + " num=" + dc.getFontHeight(Graphics.FONT_NUMBER_MEDIUM));
```

Do this instead of guessing. It costs one build.

## Derive the vertical stack at draw time

```monkeyc
function onUpdate(dc as Dc) as Void {
    var labelH = dc.getFontHeight(Graphics.FONT_XTINY);
    var valueH = dc.getFontHeight(Graphics.FONT_TINY);

    var rowTop     = HEADER_Y + labelH + GAP;
    var columnBottom = rowTop + (rows * (valueH + GAP));
    var ruleY      = clampRuleY(columnBottom + GAP_ABOVE_RULE, labelH);
    var footer1Y   = ruleY + GAP_BELOW_RULE;
    var footer2Y   = footer1Y + labelH + GAP_BETWEEN_ROWS;
    ...
}
```

`Layout` holds gaps and ratios; the view holds the arithmetic. Keep `Dc` out of
`Layout` so the geometry stays unit-testable.

## Clamp, so the bottom cannot fall off

Deriving is not enough. If everything above grows, the footer walks off the
screen and vanishes silently. Reserve its space first and let the stack above
give way:

```monkeyc
function clampRuleY(derived as Number, footerH as Number) as Number {
    var reserved = (footerH * 2) + GAP_BELOW_RULE + GAP_BETWEEN_ROWS;
    var maxRuleY = SCREEN - BOTTOM_MARGIN - reserved;
    return derived > maxRuleY ? maxRuleY : derived;
}
```

Pin it with a sweep, not a single case:

```monkeyc
(:test)
function footerStaysOnScreenForAnyPlausibleFont(logger as Logger) as Boolean {
    for (var labelH = 14; labelH <= 40; labelH += 1) {
        for (var timeH = 40; timeH <= 120; timeH += 4) {
            if (footerBottom(labelH, timeH / 2, timeH) >= Layout.SCREEN) {
                return false;
            }
        }
    }
    return true;
}
```

A single-value test passes with the font height you happened to assume. The sweep
is what catches the device you have not tried.

## Round screens

The screen is a circle; the bounding box is a lie.

```monkeyc
// Widest half-chord at a given y.
function halfWidthAt(y as Number) as Number {
    var dy = y - CENTER;
    var inside = (CENTER * CENTER) - (dy * dy);
    return inside <= 0 ? 0 : Math.sqrt(inside).toNumber();
}

// Usable X corridor for a row, measured at whichever edge the curve cuts first.
function rowXBounds(topY as Number, height as Number) as Array<Number> {
    var worstY = topY < CENTER ? topY : topY + height;
    var half = halfWidthAt(worstY) - MARGIN;
    if (half < 0) { half = 0; }
    return [CENTER - half, CENTER + half] as Array<Number>;
}
```

**A row is cut at its lowest edge if below centre, its highest if above.** Using
the row's top for a bottom row is the classic error — it reports space that is
not there.

**Rectangles fail at their corners, not their edges.** Checking the sides of a
panel against `halfWidthAt` passes while the corners hang outside the bezel:

```monkeyc
function cornerInsideBezel(x as Number, y as Number) as Boolean {
    var dx = x - CENTER;
    var dy = y - CENTER;
    return ((dx * dx) + (dy * dy)) < (CENTER * CENTER);
}
```

**The bottom of a round face is narrow.** At y=246 on a 260px screen only ~110px
of width remains. Two label/value pairs do not fit there; one does. Test for real
width, not merely a non-negative corridor:

```monkeyc
(:test)
function footerKeepsEnoughWidthForItsPair(logger as Logger) as Boolean {
    var bounds = Layout.rowXBounds(footerY, footerH);
    return (bounds[1] - bounds[0]) >= 90;
}
```

## Seven-segment digits

No system font is a segment display, and a rounded sans-serif `4` is the single
thing that gives away a digital-watch homage. Draw them.

```monkeyc
module Seg7 {
    const SEG_A = 0x01; const SEG_B = 0x02; const SEG_C = 0x04; const SEG_D = 0x08;
    const SEG_E = 0x10; const SEG_F = 0x20; const SEG_G = 0x40;
    const ALL = 0x7F;

    //   aaaa
    //  f    b
    //   gggg
    //  e    c
    //   dddd
    const DIGITS = [
        SEG_A|SEG_B|SEG_C|SEG_D|SEG_E|SEG_F,      // 0
        SEG_B|SEG_C,                              // 1
        SEG_A|SEG_B|SEG_G|SEG_E|SEG_D,            // 2
        SEG_A|SEG_B|SEG_G|SEG_C|SEG_D,            // 3
        SEG_F|SEG_G|SEG_B|SEG_C,                  // 4
        SEG_A|SEG_F|SEG_G|SEG_C|SEG_D,            // 5
        SEG_A|SEG_F|SEG_G|SEG_E|SEG_C|SEG_D,      // 6
        SEG_A|SEG_B|SEG_C,                        // 7
        ALL,                                      // 8
        SEG_A|SEG_B|SEG_C|SEG_D|SEG_F|SEG_G       // 9
    ];

    // Mitred ends, so segments interlock at the corners instead of merging
    // into a solid block.
    function horizontal(dc as Dc, x as Number, y as Number, w as Number, t as Number) as Void {
        var h = t / 2;
        dc.fillPolygon([
            [x + h, y], [x + w - h, y], [x + w, y + h],
            [x + w - h, y + t], [x + h, y + t], [x, y + h]
        ] as Array<[Numeric, Numeric]>);
    }

    function vertical(dc as Dc, x as Number, y as Number, len as Number, t as Number) as Void {
        var h = t / 2;
        dc.fillPolygon([
            [x, y + h], [x + h, y], [x + t, y + h],
            [x + t, y + len - h], [x + h, y + len], [x, y + len - h]
        ] as Array<[Numeric, Numeric]>);
    }

    // Both vertical runs span from their end of the cell to the centred middle
    // bar: half the cell plus half a bar thickness.
    function drawMask(dc as Dc, mask as Number, x as Number, y as Number,
                      w as Number, h as Number, t as Number) as Void {
        var mid = y + (h / 2) - (t / 2);
        var right = x + w - t;
        var vlen = (h / 2) + (t / 2);

        if (mask & SEG_A) { horizontal(dc, x, y, w, t); }
        if (mask & SEG_G) { horizontal(dc, x, mid, w, t); }
        if (mask & SEG_D) { horizontal(dc, x, y + h - t, w, t); }
        if (mask & SEG_F) { vertical(dc, x, y, vlen, t); }
        if (mask & SEG_B) { vertical(dc, right, y, vlen, t); }
        if (mask & SEG_E) { vertical(dc, x, mid, vlen, t); }
        if (mask & SEG_C) { vertical(dc, right, mid, vlen, t); }
    }
}
```

**Draw the unlit segments.** A real module shows them faintly, so a `1` sits
inside a visible `8`. This single detail is most of what makes drawn digits read
as a crystal rather than a font. Draw the ghost with `ALL` first, then the value
on top.

Two things this costs you:

- Ghosts destroy legibility below about 60px. At icon size, the faint `8` behind
  a `1` wins and every digit reads as `8`. Omit them there.
- Ghost colour must sit between panel and segment. Against a white panel,
  `0x555555` ghosts compete with lit digits — use `0xAAAAAA`.

Blank a leading zero by drawing only the ghost, not by drawing `0`. Return
`null` from the digit provider so the drawing code can tell "blank" from "the
digit nought" — they are different pictures.

## Miscellaneous

- Centring an odd width leaves a 1px skew from integer division. Write the test
  to allow `<= 1` rather than forcing every constant to stay even.
- Draw filled shapes rather than stroked outlines when the geometry has been
  checked against a boundary: a stroke straddles its path, putting half its width
  outside what you verified.
- Order matters when compositing. Pasting a square image over a ring erases it.

## Fonts are tiers, not pixel heights

`FONT_XTINY` is not a size — it is a request, and the device answers with a
glyph proportionate to its own screen. A 454px watch supplies a materially
taller `FONT_XTINY` than a 260px one, unasked.

So when text looks wrong at a new resolution, **the bug is a length that failed
to scale, never the font**. Do not branch on screen size to pick a bigger tier:
that double-scales, and labels end up wider than the containers naming them.
Tried on a real face, `FONT_SMALL` on a 1.75x screen made a four-character
subdial label wider than the arc it sat inside; plain `FONT_XTINY` was correct
on sight.

The cheap check before theorising: does a sibling face that never touched its
fonts render correctly at the new size? If yes, fonts are not your problem.

**Where a font tier IS a real constraint, the limit is the container.** A label
inside a 30-unit arc has to fit that arc at every resolution, which is a
different question from how it scales. Derive placement from the MEASURED glyph:

```monkeyc
var h = dc.getFontHeight(Fonts.label());
var y = cy + DIGIT_TOP_DY - Layout.grid(2) - h;   // seat it on its own height
```

A fixed offset scales with the screen while the glyph does not, which puts the
label on top of its own digits at one size and adrift at another.
