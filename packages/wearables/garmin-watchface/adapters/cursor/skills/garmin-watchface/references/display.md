# The display

Two hardware facts drive every colour decision. Both are invisible in the
simulator, which renders on a backlit LCD and flatters everything.

## Transflective MIP: brightness is reflectance

Most fenix/Forerunner/Instinct screens are memory-in-pixel, **transflective, with
no backlight**. Pixels reflect ambient light rather than emitting it. So a
colour's brightness *is* how much light it returns to the eye.

| Colour | Reflects |
| --- | --- |
| `0xFFFFFF` | all three channels — brightest available |
| `0xAAAAAA` | about two-thirds of white |
| `0x555555` | about a third |
| `0x00FF00` | green only — roughly a third of white |

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
- Prefer luminance hierarchy — label grey, value white — over hue.
- One accent colour on the whole face, used once.

## AMOLED devices

Venu and newer devices are emissive and do not share these constraints, but they
do have burn-in protection requirements and an always-on mode with a pixel budget.
Do not carry MIP palette reasoning onto them unexamined.
