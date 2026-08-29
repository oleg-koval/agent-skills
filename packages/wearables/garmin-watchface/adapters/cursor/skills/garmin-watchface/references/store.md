# Publishing

**Portal:** <https://apps.garmin.com/developer/dashboard>
**Guidelines:** <https://developer.garmin.com/connect-iq/app-review-guidelines/>

Upload is a single file: the `.iq` from `make package`. It is a multi-device
bundle — every declared product is inside it. Nothing else to attach.

## App settings on compatible watches, phones, and desktop

Compatible devices can expose an app-defined on-device settings flow when the
watch face implements one. Properties and settings declared in XML remain
configurable through the Garmin Connect mobile app or Garmin Express. In Garmin
Connect, users configure via:

Garmin Connect app → device → Connect IQ Apps → Watch Faces → *your face* → gear.

Say this in the listing or it reads as a missing feature.

Wiring, three files plus a handler:

```xml
<!-- resources/settings/properties.xml -->
<properties>
    <property id="proMode" type="boolean">false</property>
</properties>

<!-- resources/settings/settings.xml -->
<settings>
    <setting propertyKey="@Properties.proMode" title="@Strings.SettingProMode">
        <settingConfig type="boolean" />
    </setting>
</settings>
```

```monkeyc
// getValue THROWS when a key is absent from the app settings XML.
// Wrap every read and supply a default.
function boolSetting(key as String, fallback as Boolean) as Boolean {
    try {
        var value = Application.Properties.getValue(key);
        if (value instanceof Lang.Boolean) { return value as Boolean; }
    } catch (e) {
        return fallback;
    }
    return fallback;
}
```

```monkeyc
// In the AppBase subclass -- without this the face keeps its old settings
// until it is reselected.
function onSettingsChanged() as Void {
    WatchUi.requestUpdate();
}
```

Re-read settings in both `onLayout` and `onShow`.

See `references/simulator.md` for why the simulator will lie to you about this.

## Intellectual property

Review the live [Garmin Connect IQ Developer
Agreement](https://developer.garmin.com/downloads/connect-iq/sdks/agreement.html)
before publishing. It requires developers to hold the necessary intellectual
property rights for the app and its store materials. Garmin may refuse or remove
a listing, and may immediately remove or suspend an app that violates the
agreement.

Practical tiers for an homage:

- **Highest risk:** a film title or real brand in the app name, launcher icon, or
  screenshots. That is trademark use for product identity.
- **Lower risk:** one factual, referential sentence in the description body.
- **Lower risk, and usually better copy:** describe the *object* and the *era*. The
  people who will recognise it recognise the shape, not the name.

"The brand is dead so I can use it" does not hold. Abandonment is a legal finding
requiring genuine non-use with no intent to resume, and it is moot if anyone holds
a live registration — renewal is cheap and dormant heritage marks are routinely
warehoused and revived. Check the registers before relying on it: USPTO Trademark
Search, EUIPO eSearch, WIPO Global Brand Database, and the national register of
the owner's country.

These tiers reduce risk; none eliminates it. Require legal review before
publishing an homage.

## Donation links

Permitted, with care. The agreement restricts advertising-focused listings and
affiliate traffic, and store requirements call for disclosing whether payment is
needed. A single support line **after** a complete description, prefixed with
*free*, addresses both concerns. Leading with it, or repeating it in the short
description, does not.

## Screenshots

Regenerate from the build you are uploading, not an older one. Stale screenshots
are the most common thing to forget after a redesign, and they misrepresent the
version under review.

```bash
make build && make sim
<skill-dir>/scripts/ciq-capture docs/store/screenshot.png --face --size 260 --mask
```

Generate the launcher icon and any hero image from the same geometry the face
uses, in a checked-in script, so they cannot drift from what the device renders.
Two things that bite when reusing face-drawing code for artwork:

- **Polarity must invert with the surface.** Face colours drawn on a hero's dark
  background paint dark-on-dark and vanish. Take colours as parameters.
- **Detail that sells at full size destroys legibility at icon size.** Ghost
  segments turn every digit into an `8` at 40px. Drop them there.

## Checklist

- [ ] `make test` passes — and the tests actually compile (`references/testing.md`)
- [ ] `make lint` clean at level 3
- [ ] `make package` builds every declared device
- [ ] Developer key not committed
- [ ] Screenshots regenerated from this build
- [ ] Launcher icon is yours, at the size each device wants
- [ ] Listing explains where settings are available for supported devices
- [ ] No third-party marks in name, icon, screenshots, or copy
- [ ] Verified on real hardware in daylight, not just the simulator

## Key hygiene

The developer key signs your app id. Lose it and you cannot update the listing;
commit it and anyone can impersonate your app.

```bash
make key    # generates ~/.Garmin/ConnectIQ/developer_key.der
```

Back it up somewhere private. Keep `bin/` and the key out of git, and run a
pre-commit check that greps for `.der`/`.pem` in the index.
