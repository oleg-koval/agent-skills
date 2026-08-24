# Testing

## The trap: a green run with zero tests compiled

`monkey.jungle` almost always contains:

```
base.excludeAnnotations = test
```

That is correct — test code must not ship in the store build. But it strips
`(:test)` from **every** target, including `--unit-test`. The result:

```
BUILD SUCCESSFUL
Ran 0 tests
```

or, worse, a green run reported against stale test files that reference deleted
symbols. Tests written months ago may never have executed once.

**Fix** — a second jungle, passed as an additional `-f`:

```
# monkey.test.jungle
# Loaded only for `make test`, after monkey.jungle, so (:test) code actually
# compiles. The grammar requires a value here, so this is a placeholder that
# matches no annotation.
base.excludeAnnotations = none
```

```makefile
TEST_JUNGLE := monkey.jungle;monkey.test.jungle

test:
	$(MONKEYC) -f "$(TEST_JUNGLE)" -d $(DEVICE) -o $(APP) -y $(KEY) -w -l 2 --unit-test
	$(MONKEYDO) $(APP) $(DEVICE) -t
```

Note `base.excludeAnnotations =` with an empty value is a **syntax error**. Use a
placeholder like `none`.

**Prove your tests compile.** Do not take a green run on trust:

```monkeyc
(:test)
function someExistingTest(logger as Logger) as Boolean {
    return ThisDoesNotExist.definitelyNotAFunction();   // must FAIL the build
}
```

If the build still succeeds, nothing is being compiled. Run this check whenever
you inherit a project or change the jungle.

## What is worth testing

Monkey C unit tests run on-device or in the simulator and can only assert on pure
logic — you cannot inspect rendered pixels. So test the two things that are pure:
**geometry** and **formatting**. Keep `Dc` out of `Layout` and `Fields` and they
stay testable.

### Geometry invariants

```monkeyc
(:test)
function goalBarClearsBothTextColumns(logger as Logger) as Boolean {
    var barEnd = Layout.BAR_X + Layout.BAR_W;
    return (Layout.BAR_X - Layout.LABEL_X) >= 40
        && (Layout.VALUE_X - barEnd) >= 40;
}
```

### Sweeps, not single values

The single most valuable pattern here. A point test passes with the font height
you assumed; the sweep catches the device you have not tried:

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

### Lookup tables where a typo is plausible

A mistyped segment mask produces a *plausible* wrong digit — a `6` missing its
top bar still reads as a `6` to a careless eye. Pin by count plus the specific
features that distinguish neighbours:

```monkeyc
(:test)
function everyDigitLightsTheRightNumberOfSegments(logger as Logger) as Boolean {
    var expected = [6, 2, 5, 5, 4, 5, 6, 3, 7, 6];
    for (var d = 0; d <= 9; d += 1) {
        var count = 0;
        for (var bit = 0; bit < 7; bit += 1) {
            if ((Seg7.maskFor(d) & (1 << bit)) != 0) { count += 1; }
        }
        if (count != expected[d]) { return false; }
    }
    return true;
}

(:test)
function zeroHasNoMiddleBarButEightDoes(logger as Logger) as Boolean {
    return !Seg7.isLit(Seg7.maskFor(0), Seg7.SEG_G)
        && Seg7.isLit(Seg7.maskFor(8), Seg7.SEG_G);
}
```

### Thresholds, with the reasoning in the test name

```monkeyc
// A 14-day watch at 50% has a week left. Treating that as a warning was the bug.
(:test)
function halfChargeIsHealthyNotCaution(logger as Logger) as Boolean {
    return Fields.batteryColor(50.0) == Palette.LABEL;
}
```

### Dead code

If a function is tested but never called, the tests pass and the feature does not
exist. Grep for call sites of anything you have just written a test for.

## What tests cannot catch

Everything visual. Overlapping rows, a bar through a label, a face that is too
dim, content drawn off-screen — all of it passes a green suite. **Capture a
screenshot and look at it before committing.** Every visual bug in this skill's
history was found by looking.

```bash
make build && make sim
bin/ciq-capture /tmp/face.png --face --size 260
# then Read the PNG
```

## Running

```bash
make test          # compile with the test jungle and run
```

`monkeydo ... -t` prints per-test PASS/FAIL and a summary. It also wedges often;
see `reference/simulator.md`.
