# Device support

## Products, devices, and what "5 out of 5 built" means

A `<iq:product>` in the manifest often covers several marketing variants that
share hardware. Declaring `fenix6pro` alone produces `5 OUT OF 5 DEVICES BUILT`
— fenix 6 Pro, 6 Sapphire, 6 Pro Solar, 6 Pro Dual Power, quatix 6. That is one
layout, not five. Do not read the count as breadth.

## Widening cheaply

A face written against one resolution ports for free to every device sharing it —
a manifest edit, no code change.

```bash
bin/ciq-devices --same-as fenix6pro
```

That prints the `<iq:product>` lines to paste, flags devices below your
`minApiLevel`, and warns when launcher icon sizes differ.

Representative clusters (installed SDK, mid-2026):

| Resolution | Devices |
| --- | --- |
| 240x240 | 38 |
| 390x390 | 22 |
| 260x260 | 13 |
| 454x454 | 12 |
| 218x218 | 11 |
| 240x400 | 9 (rectangular) |

## Then actually build each one

Compiling is the cheapest verification and it catches real problems:

```bash
for d in fenix6 fenix7 fr955 vivoactive4; do
  monkeyc -f monkey.jungle -d $d -o bin/t-$d.prg -y $KEY -w -l 3 \
    | sed "s/^/$d: /"
done
```

Two things that surface here and nowhere else:

**API level.** `ERROR: Device 'approachs62' does not support API Level '3.1.0'.`
A device can share your resolution and still be excluded. Drop it, or lower
`minApiLevel` and give up the APIs you were using.

**Launcher icon size.** `WARNING: The launcher icon (40x40) isn't compatible with
the specified launcher icon size of the device 'vivoactive4' (35x35). The image
will be scaled.` Scaling blurs detail at a size where it is already marginal.
Give those devices their own resource path:

```
# monkey.jungle
base.resourcePath = resources

# resources-35 is listed second so its drawables win.
vivoactive4.resourcePath = $(base.resourcePath);resources-35
legacyherofirstavenger.resourcePath = $(base.resourcePath);resources-35
```

with `resources-35/drawables/` holding both `drawables.xml` and the 35x35 PNG.

## What does not port

Compiling clean does **not** mean it looks right. It will compile and look wrong,
which is worse than failing.

Before declaring a device of a different size or shape:

1. **Absolute pixel constants.** Anything like `const PANEL_X = 30` needs to
   become a fraction of `dc.getWidth()`.
2. **Round-bezel assumptions.** `halfWidthAt()` computes a curve that does not
   exist on a rectangular screen and needlessly squeezes content; on 240x400 it
   is badly wrong. Branch on `System.getDeviceSettings().screenShape`.
3. **Font heights.** They differ between devices at the *same* resolution. Derive
   everything (see `reference/layout.md`); a fixed Y that fits a 19px glyph
   overflows a 24px one.
4. **Sensor availability.** Body Battery and stress are absent on older and
   cheaper devices. Guard with `Toybox has :SensorHistory` and degrade to `--`.

If the layout is not resolution-aware, say so in the manifest so the next person
does not "helpfully" add products:

```xml
<!-- Every product here is 260x260, the only resolution this face supports:
     Layout uses absolute pixel constants and halfWidthAt() assumes a round
     bezel. Another size or shape will compile and look wrong, not fail. -->
```

## Launcher icons differ within a resolution family

`ciq-devices --same-as <device>` prints this, and it is easy to skip past. Sizes
seen in practice: 35×35 (vivoactive 4, the legacy hero editions), 40×40 (fenix
6/7 at 260×260), 60×60 (descent mk3 51mm, epix 2 pro 51mm), 65×65 (the 454×454
AMOLED group).

Give each size its own `resourcePath` in the jungle, listed *after* the base so
its drawables win:

```
fr970.resourcePath = $(base.resourcePath);resources-65
```

**Do not upsample.** A 40×40 icon scaled to 65×65 turns 2px segment bars into
grey smears. Draw it at size — render at 8× and downsample once with a good
filter, which is what gives rounded corners and stroke ends clean edges at these
sizes. Keep the generator in `tools/` so the next size is one command.

## Making `Layout` resolution-aware

Worth doing once a face has traction, and much less risky than it sounds if you
treat the original numbers as a **design grid** rather than replacing them:

```monkeyc
const DESIGN = 260;              // a unit, not a screen size
var FRAME_W as Number = 204;     // var, not const -- init() rewrites these

// Round, don't truncate: truncation biases every constant down by up to a
// pixel, and across a gasket and two insets that is a visible seam.
function grid(value as Number) as Number {
    return ((value * SCREEN) + (DESIGN / 2)) / DESIGN;
}

function init(width as Number) as Void {
    SCREEN = width;
    CENTER = width / 2;
    FRAME_W = grid(204);
    // ...
    if (STROKE < 1) { STROKE = 1; }   // a stroke rounded to 0 draws nothing
}
```

Call it from `onLayout(dc)` with `dc.getWidth()` — never from a device name, so
a new product needs no code at all.

Three things this gets wrong if you are not careful:

1. **Relational tests keep passing at the new size but prove nothing new.** Most
   layout assertions are written as comparisons, so they hold at any scale
   *given whatever Layout currently holds*. Add a test that sweeps every shipped
   resolution, calling `init()` for each and restoring the design grid on exit.
2. **A scale function that ignored its argument would pass all of those.** Pin
   growth explicitly: 204 on the grid must land near 356 at 454.
3. **Rounding direction is untested by default.** Assert `grid(1) == 2` at 454,
   not just `grid(1) >= 1`.

## Recommended order

1. Ship one resolution, verified on your own wrist.
2. Add the same-resolution family — biggest reach per unit of risk.
3. Make `Layout` resolution-aware only if it gets traction. It is real work and
   it risks the pixel-exact look you tuned.
4. Crossing to AMOLED is a *separate* step from crossing resolution, even though
   the 454×454 group makes them arrive together. See the always-on section in
   `reference/display.md` — that is the part that fails review, not the layout.
