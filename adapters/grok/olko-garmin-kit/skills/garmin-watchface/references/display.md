# The display

Two hardware facts drive every colour decision. Both are invisible in the
simulator, which renders on a backlit LCD and flatters everything.

## Transflective MIP: brightness is reflectance

Most fenix/Forerunner/Instinct screens are memory-in-pixel, **transflective, with
no backlight**. Pixels reflect ambient light rather than emitting it. So a
colour's brightness *is* how much light it returns to the eye.

| Colour | Reflects |
| --- | --- |
| `0xFFFFFF` | all three channels: brightest available |
| `0xAAAAAA` | about two-thirds of white |
| `0x555555` | about a third |
| `0x00FF00` | green only: roughly a third of white |

**Consequence 1: large areas must be bright.** Choosing a photographically
accurate mid-grey for the biggest region on the face makes the whole watch read
as dim on the wrist while looking correct in the simulator. If a design has a
large panel, `0xFFFFFF` is usually the right answer even when a reference
photograph says otherwise.

**Consequence 2: never colour the thing you need to read.** A saturated colour on
a glyph reflects only its own channel, making the number you are trying to read
the *dimmest* thing on screen. Put status colour on a chip, bar, or rule beside
the value and keep the value white.

If a user insists on coloured values, say once that it costs outdoor legibility,
then do it. It is their watch.

**Consequence 3: big saturated fills shout.** A colour that reads as informative
at glyph size is overwhelming across a progress bar. Keep a separate pale tint
for large fills:

```monkeyc
const READY   = 0x55FF55;   // status, at glyph size
const FILL_OK = 0xAAFFAA;   // the same meaning, across a large area
```

## The 64-colour lattice

Many devices quantise to 4 levels per channel: `0x00 / 0x55 / 0xAA / 0xFF`. A
colour not already on the lattice is snapped at draw time, so **what you picked
is not what ships**. Greys and golds drift most visibly.

Useful quantisations:

| Intent | Nearest lattice point | Reads as |
| --- | --- | --- |
| Gold `(212,175,90)` | `0xAAAA55` | olive/khaki |
| Brighter gold | `0xFFAA55` | orange |
| Amber warning | `0xFFAA00` | strong orange |
| Sky blue | `0x55AAFF` | good |
| Mid grey | `0xAAAAAA` | good |

There is no good gold. Say so rather than iterating.

Pin every palette constant with a test:

```monkeyc
const LEVELS = [0x00, 0x55, 0xAA, 0xFF];

function quantizeChannel(value as Number) as Number {
    var nearest = LEVELS[0];
    var best = 256;
    for (var i = 0; i < LEVELS.size(); i += 1) {
        var d = (value - LEVELS[i]).abs();
        if (d < best) { best = d; nearest = LEVELS[i]; }
    }
    return nearest;
}

function quantize(color as Number) as Number {
    return (quantizeChannel((color >> 16) & 0xFF) << 16)
         | (quantizeChannel((color >> 8) & 0xFF) << 8)
         |  quantizeChannel(color & 0xFF);
}

function isLatticeExact(color as Number) as Boolean {
    return quantize(color) == color;
}
```

```monkeyc
(:test)
function everyPaletteColourSurvivesQuantization(logger as Logger) as Boolean {
    var colors = [Palette.BG, Palette.VALUE, Palette.LABEL /* ... */];
    for (var i = 0; i < colors.size(); i += 1) {
        if (!Palette.isLatticeExact(colors[i])) { return false; }
    }
    return true;
}
```

Also pin the *relationships*, which is what actually breaks:

```monkeyc
(:test)
function panelIsLighterThanItsSegments(logger as Logger) as Boolean {
    return Palette.PANEL > Palette.SEGMENT;
}
```

## Colour discipline that survives contact with a wrist

- Reserve colour for states worth interrupting a glance for. A green "50%"
  battery is decoration that costs luminance and teaches the eye to ignore
  colour.
- Set thresholds against the device, not phone habits. A 14-day watch at 50% has
  a week left; that is not a warning.
- Prefer luminance hierarchy (label grey, value white) over hue.
- One accent colour on the whole face, used once.

## AMOLED devices

Venu, Forerunner 265/965/970, fenix 8 (non-solar) and epix are **emissive**.
Almost every rule above inverts, and the one that matters most is not about
colour at all.

Read the device rather than guessing: `compiler.json` carries `displayType`,
`bitsPerPixel` and `alphaBlendingSupport`:

| | fenix 6 Pro | Forerunner 970 |
| --- | --- | --- |
| `displayType` | `mip` | `amoled` |
| Resolution | 260×260 | 454×454 |
| `bitsPerPixel` | 8 | 16 |
| `alphaBlendingSupport` | false | **true** |
| Launcher icon | 40×40 | **65×65** |

So on AMOLED you get anti-aliasing and real colour, and the 4×4×4 lattice stops
being a constraint. Lattice colours still render correctly, so a palette tuned
for MIP is safe to ship to both: it is merely conservative.

### The always-on frame is the whole problem

`System.getDeviceSettings().requiresBurnInProtection` is true on these devices.
Between wrist raises the face must show a restricted frame: a small fraction of
pixels lit, and not always the *same* pixels. Garmin rejects faces that ignore
this.

The property arrived after some supported products shipped and **can be null**,
so check both the symbol and the value: a null flowing into a `Boolean` field
throws at the first wrist drop:

```monkeyc
private function needsAlwaysOn() as Boolean {
    var s = System.getDeviceSettings();
    if (!(s has :requiresBurnInProtection)) { return false; }
    var flag = s.requiresBurnInProtection;
    return flag != null && flag;
}
```

**The always-on frame is a different drawing, not a dimmed one.** This is the
part that bites: if the face's identity is a large bright area (a lit LCD
panel, a white dial, a filled gauge), then dimming it still lights most of the
screen. Reach instead for what the real object looks like with the power off.
An outline where there was a fill; strokes where there was a panel.

Budget check: on 454×454 (206k pixels), seven-segment strokes for four digits
plus a 1px frame outline is roughly 2% lit. A filled rounded rectangle the size
of that frame alone is 40k pixels (19%).

### Move the lit pixels

Static content burns the pixel even at low duty. Shift the whole block by a few
pixels on a cycle, and make the horizontal and vertical periods **coprime** so
the pair does not return to the same offset every few minutes:

```monkeyc
const SHIFT_PERIOD = 7;      // x
const SHIFT_PERIOD_Y = 5;    // y  -> 35 distinct positions, not 7

function shiftX(minute as Number) as Number {
    return (minute % SHIFT_PERIOD) - (SHIFT_PERIOD / 2);
}
```

Both periods dividing into 60 is the trap: with 6 and 3 you get 6 positions and
park a segment edge on the same pixels ten times an hour.

Test the arithmetic even though you cannot test the drawing: that the offsets
stay small enough to keep content on screen, that **every** offset in range is
actually visited (a `shiftX` stuck at 0 passes "stays small" and protects
nothing), and that the (x, y) pair yields the full period.

### Helpers that pick their own colour

Segment and hand renderers commonly call `dc.setColor(Palette.SEGMENT, ...)`
internally. Reusing them for the always-on frame silently repaints it in the
lit-face colour. Either pass the colour in, or draw the always-on frame against
the mask primitives directly.
