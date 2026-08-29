# The simulator

## It persists app settings and ignores your defaults

Changing a default in `properties.xml` does **not** change what the simulator
shows. It keeps the value it persisted the first time the app ran, so a property
reads `false` while the XML plainly says `true`. This looks exactly like broken
settings code and will send you debugging the wrong thing.

Clear it: **File → Reset All App Data**. That also drops the loaded device, so
relaunch the simulator and re-push afterwards.

Diagnose before assuming a bug — print what the app actually sees:

```monkeyc
System.println("SETTINGS pro=" + _proMode + " ghost=" + _ghost);
```

If one property matches its XML default and another does not, you are looking at
stale persistence, not a bug.

## monkeydo wedges

Regularly. Symptoms: exit 124, no output, or a hang with no push.

```bash
pkill -f monkeydo
pkill -x simulator            # NOT `pkill -f simulator` -- see below
"$SDK/bin/connectiq" &
sleep 12
"$SDK/bin/monkeydo" bin/app.prg fenix6pro
```

**Use `pkill -x simulator`, not `pkill -f simulator`.** The `-f` form matches the
full command line of every process, and unrelated applications carry the word
"simulator" in their arguments -- Claude Desktop's helper processes register a
`claude-simulator` URL scheme, for instance. `pkill -f simulator` kills them too.
`-x` matches the process name exactly.

The simulator needs about 10-12 seconds before it will accept a push, and a
further beat before its window is scriptable. Pushing too early gives a window
titled "CIQ Simulator" with no device name and no display.

For a watch face `monkeydo` does not exit on its own — it stays attached. That is
normal; Ctrl-C once the face renders.

## Screenshots

Use `<skill-dir>/scripts/ciq-capture`. If you must do it by hand, know the three failure modes:

**1. `screencapture -R` grabs a screen region, not a window.** If the simulator is
not in front you get a photograph of your terminal, saved successfully, with no
error. Always raise the window and verify it came forward:

```bash
osascript -e 'tell application "System Events" to tell process "simulator" to set frontmost to true'
sleep 2
osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'
```

**2. The window moves between restarts.** Read its bounds every time:

```bash
osascript -e 'tell application "System Events" to tell process "simulator" to get {position, size} of (first window whose name contains "CIQ Simulator")'
```

**3. The display is a sub-rectangle of the window.** Do not guess it. Render a
full-screen marker colour, capture, and take its bounding box — that is the
display rect exactly. `<skill-dir>/scripts/ciq-calibrate` automates this. On a 2x Retina Mac with
the fenix 6 Pro skin the answer is 518x518 at (155,345), a clean 2:1 for the
260x260 display.

Sanity check the result before believing it. A watch face is neither a blank
white page nor solid black; if the dark fraction is outside roughly 25-90%, you
captured the wrong window.

**Mask round displays.** The square capture picks up a few pixels of the
simulator's bezel skin in its corners, which do not exist on the device. Mask at
4x and downsample or the edge stair-steps.

The simulator's own **File → Save Screen Capture** works too, but its save dialog
is a Java panel that does not respond to `Cmd+Shift+G` or normal AppleScript UI
scripting. Fine by hand, not automatable.

## Menus worth knowing (AppleScript-drivable)

```bash
osascript -e 'tell application "System Events" to tell process "simulator" to get name of every menu item of menu 1 of menu bar item "File" of menu bar 1'
```

| Menu | Item | Use |
| --- | --- | --- |
| File | Save Screen Capture | manual screenshot |
| File | Reset All App Data | clear persisted settings |
| File | Kill App | stop without closing |
| Settings | Set Battery Status | test battery thresholds |
| Settings | Set User Profile | resting HR and similar |
| Settings | Trigger App Settings | fire `onSettingsChanged` |
| Simulation | Activity Data | non-zero steps/calories |
| Simulation | Time Simulation | check other times of day |

The simulator reports zero steps and calories by default, because it has no
activity data — not because your render path is broken. Use Simulation →
Activity Data before concluding anything.

## Sensor data

`Toybox.SensorHistory` returns iterators whose most recent buckets are often
`null`. Take the newest **non-null** sample rather than the newest sample:

```monkeyc
const SCAN_DEPTH = 24;

function bodyBattery() as Number? {
    if (!(Toybox has :SensorHistory)
        || !(Toybox.SensorHistory has :getBodyBatteryHistory)) {
        return null;
    }
    var it = Toybox.SensorHistory.getBodyBatteryHistory(
        {:period => SCAN_DEPTH,
         :order => Toybox.SensorHistory.ORDER_NEWEST_FIRST});
    if (it == null) { return null; }
    var seen = 0;
    while (seen < SCAN_DEPTH) {
        var sample = it.next();
        seen += 1;
        if (sample != null && sample.data != null) {
            return sample.data.toNumber();
        }
    }
    return null;
}
```

Always guard with `Toybox has :SensorHistory` — not every device has it, and the
face must degrade to `--` rather than crash.

## Verifying on real hardware

The simulator renders on a backlit LCD and flatters everything. Colour, contrast
and legibility decisions are not verified until seen on the device in daylight.
Deploy over USB:

```bash
make build
cp bin/app.prg /Volumes/GARMIN/GARMIN/APPS/
# eject, then pick the face on-device
```
