---
name: garmin-watchface
description: Build, test, screenshot and publish Garmin Connect IQ watch faces in Monkey C. Use when working on a Connect IQ watch face or app - creating one, fixing layout that clips or overlaps, capturing simulator screenshots, adding app settings, widening device support, or preparing a Connect IQ Store submission. Encodes the traps that silently produce a passing build and a broken face.
---

# Garmin Connect IQ watch faces

Monkey C gives you almost no safety net. The compiler is happy to build a face
that draws off the bottom of the screen, a test suite that contains no tests, and
a colour that is not the colour you get. Everything below is a failure mode that
looked like success first.

**Read `reference/` files as needed — do not read them all up front.**

| File | When |
| --- | --- |
| `reference/display.md` | Choosing colours, brightness, legibility; **AMOLED always-on and burn-in** |
| `reference/layout.md` | Positioning anything; content clipped, overlapping, or off-screen |
| `reference/testing.md` | Writing tests; a suspiciously clean test run |
| `reference/simulator.md` | Screenshots, settings not applying, monkeydo hanging |
| `reference/devices.md` | Adding device support, launcher icons, API levels |
| `reference/store.md` | Publishing, listing copy, IP questions |
| `reference/publishing.md` | Driving the store portal in a browser; upload/update flow, validator rejections |

## Tools

Run these rather than reinventing them. All are standalone.

```bash
bin/ciq-doctor                    # toolchain check: SDK, JDK, key, devices
bin/ciq-devices                   # survey installed devices by resolution
bin/ciq-devices --same-as fenix6pro   # products you can add with no code change
bin/ciq-capture out.png           # calibrated simulator screenshot
bin/ciq-capture out.png --face --size 260   # cropped + masked to the round display
bin/ciq-calibrate                 # re-derive the display rect if capture looks wrong
bin/ciq-release                   # pre-submission check: package, screenshots, icon, keys, copy
```

`bin/ciq-release` is what you run before opening the store portal. Every check
in it is something otherwise discovered halfway through the submission form --
a stale screenshot set, an icon still copied from the last project, or copy
containing a character the description validator rejects.

`bin/ciq-capture` exists because `screencapture -R` grabs a screen *region*, not
a window: without a frontmost check it silently photographs whatever is on top,
and the window moves between simulator restarts. Both failure modes produce a
plausible PNG of the wrong thing.

## The seven things that will bite you

### 1. `make test` can compile zero tests and report success

If `monkey.jungle` sets `base.excludeAnnotations = test`, every `(:test)`
function is stripped from **every** target, including the unit-test build. You
get `BUILD SUCCESSFUL` and a green run with nothing compiled — even when the test
files reference symbols that no longer exist.

Fix: a second jungle passed as an additional `-f`. See
`templates/monkey.test.jungle` and the `test` target in `templates/Makefile`.

**Prove it before you trust it.** Put a deliberately unresolvable symbol in one
test and confirm the build fails:

```monkeyc
return ThisDoesNotExist.definitelyNotAFunction();
```

### 2. Never hardcode a Y coordinate or assume a font height

`dc.getFontHeight()` is the only source of truth, and the numbers are larger than
they look. Measured on fenix 6 Pro:

| Font | Height |
| --- | --- |
| `FONT_XTINY` | 19 |
| `FONT_TINY` | 29 |
| `FONT_SMALL` | 32 |
| `FONT_NUMBER_MEDIUM` | 74 |

**Font tiers already scale with the device.** `FONT_XTINY` is a tier, not a
pixel height: a 454px watch supplies a proportionately taller glyph than a
260px one, unasked. So when text looks wrong at a new resolution, the bug is a
LENGTH that failed to scale, never the font. Do not add screen-size branching
to pick a bigger tier -- doing so double-scales, and labels end up wider than
the containers naming them.

Content drawn past the screen height is simply invisible — no error, no warning,
no clipping indicator. A two-line `FONT_NUMBER_MEDIUM` block is 148px of a 260px
face.

Derive every Y at draw time, and **clamp** so a bottom row cannot be pushed off:

```monkeyc
function clampRuleY(derived as Number, footerH as Number) as Number {
    var reserved = (footerH * 2) + GAP_BELOW_RULE + GAP_BETWEEN_ROWS;
    var maxRuleY = SCREEN - BOTTOM_MARGIN - reserved;
    return derived > maxRuleY ? maxRuleY : derived;
}
```

See `reference/layout.md`.

### 3. The screen is round; your layout is not

Check content against the bezel curve, not the bounding square. A rectangle
inscribed in a circle fails at its **corners** long before its sides.

```monkeyc
function halfWidthAt(y as Number) as Number {
    var dy = y - CENTER;
    var inside = (CENTER * CENTER) - (dy * dy);
    return inside <= 0 ? 0 : Math.sqrt(inside).toNumber();
}
```

### 4. Colours are quantised, and brightness is reflectance

Many devices snap to a 4×4×4 lattice: `0x00 / 0x55 / 0xAA / 0xFF` per channel. A
colour not already on it is not the colour that ships.

More important: MIP screens are **transflective with no backlight**. A colour's
brightness *is* how much ambient light it returns. Grey reflects about two-thirds
of what white does. Choosing a photographically accurate grey for a large area
makes the whole face read as dim on the wrist while looking fine in the
simulator's backlit LCD.

Corollary: a saturated colour on a glyph reflects only its own channel, making
the thing you want to read the *dimmest* thing on screen.

See `reference/display.md`.

### 5. The simulator lies about settings

It persists app settings and **ignores changed defaults in `properties.xml`**
until you do File → Reset All App Data. A property will keep reading its old
value while the XML plainly says otherwise. This looks exactly like broken
settings code.

Reset also drops the loaded device, so relaunch and re-push afterwards.

See `reference/simulator.md`.

### 6. On AMOLED, the face you designed is the one that fails review

`requiresBurnInProtection` devices must show a restricted always-on frame
between wrist raises. The trap is that the *stronger* your face's identity —
a bright panel, a filled dial — the worse a dimmed version of it performs,
because it still lights most of the screen. The always-on frame has to be a
different drawing: outlines where there were fills, and shifted a few pixels on
a cycle so no pixel is driven continuously.

Also note the flag can be **null** on older products, and a null propagating
into a `Boolean` field throws at the first wrist drop.

See the AMOLED section of `reference/display.md`.

### 7. A watch face CAN have settings on the watch

`AppBase.getSettingsView()` has existed since **API 3.2.0** and the SDK
documents it as "only applicable to watch faces and data fields". Plenty of
store copy — including, at one point, this author's own — claims settings are
reachable only from the phone. They are not.

The override signature must include `or Null` or the compiler rejects it as
narrowing:

```monkeyc
function getSettingsView() as
    [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] or Null {
    return [new SettingsMenu(), new SettingsMenuDelegate()];
}
```

Two things to get right in the menu itself:

- `ToggleMenuItem` has **already flipped its own state** by the time `onSelect`
  runs. Read `isEnabled()`; negating the stored value inverts the setting.
- A picker should `setFocus()` the current choice, not open at the top of a long
  list. If the list filters out unavailable options, item position is *not* the
  option id — count the focus row as you build the list.

Keep one module that owns every property read, each wrapped with a default, and
have both the phone path and the on-watch menu go through it. Two readers with
two sets of defaults is exactly how the watch and the phone come to disagree
about what "off" means — and check the fallbacks actually match
`properties.xml`, because nothing enforces that.

## Workflow

### Starting a face

1. `bin/ciq-doctor` — confirm SDK, JDK, developer key, target device installed.
2. Copy `templates/Makefile`, `templates/monkey.jungle`, `templates/monkey.test.jungle`.
3. Generate a fresh app id: `python3 -c "import uuid;print(uuid.uuid4().hex)"`.
4. Split source by responsibility. This structure has held up well:

| Module | Holds |
| --- | --- |
| `Palette.mc` | Colours only, all lattice-exact |
| `Layout.mc` | Geometry, derivations, bezel maths — no drawing |
| `<Widget>.mc` | Drawing primitives (rows, bars, segments) |
| `Fields.mc` | Formatting and thresholds — pure, easy to test |
| `Sensors.mc` | Sensor reads with null handling |
| `<Name>View.mc` | Composition only |

Keeping `Layout` free of `Dc` calls is what makes geometry unit-testable.

### Every change

```bash
make build && make test && make lint
```

`make lint` is level 3 and catches real problems the level 2 build allows.

### Before committing

Capture and *look at it*. Layout bugs are invisible in a passing test run:

```bash
make build && make sim
bin/ciq-capture /tmp/face.png --face --size 260
```

Then Read the PNG. Every layout bug in this skill's history was found by looking,
not by testing.

## Monkey C gotchas

- Module-level functions take **no** visibility modifier. `private` and `hidden`
  are class-only; at module scope they are syntax errors.
- `dc.fillPolygon` wants `Array<[Numeric, Numeric]>`. Cast the literal:
  `[[x, y], ...] as Array<[Numeric, Numeric]>`.
- `getInitialView()` returns
  `[WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates]`.
- `Application.Properties.getValue()` **throws** when a key is absent, which
  happens on a fresh install before settings have ever been written. Wrap every
  read with a default.
- Integer division everywhere. Centring an odd width leaves a 1px skew — write
  tests that allow it rather than forcing constants to stay even.

## Reference watches and homages

If reproducing a real object, get these right before anything else, because they
are what makes it recognisable:

- **Display polarity.** A 1970s LCD is *positive*: dark segments on a pale panel,
  the inverse of every modern face. Getting this backwards turns a crystal into a
  screen.
- **Proportion.** Bezels on vintage digitals are thick; the window is smaller
  than memory suggests.
- **Where the legends sit** — maker's name on the bezel, not the glass.

No system font is a segment display. If you need one, draw it: see
`reference/layout.md` for a working seven-segment renderer, including the ghost
(unlit) segments that are most of what sells the effect.

**Do not print a real brand on the face.** See `reference/store.md`.
