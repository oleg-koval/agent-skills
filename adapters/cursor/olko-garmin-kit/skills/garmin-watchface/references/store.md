# Publishing

**Portal:** <https://apps.garmin.com/developer/dashboard>
**Guidelines:** <https://developer.garmin.com/connect-iq/app-review-guidelines/>

Upload is a single file: the `.iq` from `make package`. It is a multi-device
bundle: every declared product is inside it. Nothing else to attach.

## App settings live on the phone, not the watch

Connect IQ watch face settings are **not reachable from the watch**. The
on-device face menu offers only Apply. Users configure via:

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
// getValue THROWS when a key is absent -- which happens on a fresh install
// before the Connect app has ever written settings. Default every read.
private function boolSetting(key as String, fallback as Boolean) as Boolean {
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

See `reference/simulator.md` for why the simulator will lie to you about this.

## Intellectual property

Section 3(a) is stricter than people expect and explicitly covers your **listing
text and images**, not just code:

> You may not infringe any copyright, trademark, patent, trade secret, or any
> other form of intellectual property. You must own or have a license to use all
> IP included in or used by your app. This includes your app's software and
> content, your developer account name, as well as the logos, images, and content
> that you use to promote your app in the Connect IQ store.

> Be careful using brand names and logos ... Be careful before making any mention
> of a brand or using any logo or name that is not yours.

And Garmin will not adjudicate:

> It is not for us to decide whether your use of a third party's IP may be
> infringing, properly used under a license, or fair use.

So there is no approval to win. They accept it, and §5(b) lets them suspend with
**no notice** if a rights holder complains: against the account, which carries
your other apps too.

Practical tiers for an homage:

- **Highest risk:** a film title or real brand in the app name, launcher icon, or
  screenshots. That is trademark use for product identity.
- **Lower risk:** one factual, referential sentence in the description body.
- **No risk, and usually better copy:** describe the *object* and the *era*. The
  people who will recognise it recognise the shape, not the name.

"The brand is dead so I can use it" does not hold. Abandonment is a legal finding
requiring genuine non-use with no intent to resume, and it is moot if anyone holds
a live registration: renewal is cheap and dormant heritage marks are routinely
warehoused and revived. Check the registers before relying on it: USPTO Trademark
Search, EUIPO eSearch, WIPO Global Brand Database, and the national register of
the owner's country. A lapsed mark you do not own is still not a mark you *own*,
which is what §3(a) asks for.

Not legal advice. When it matters, ask a lawyer, not the store.

## Donation links

Permitted, with care. §1(a) prohibits listings that are advertising-focused or
"serve primarily to drive affiliate traffic to a website", and §4(d) requires
stating whether payment is needed. A single support line **after** a complete
description, prefixed with *free*, clears both. Leading with it, or repeating it
in the short description, does not.

## Screenshots

Regenerate from the build you are uploading, not an older one. Stale screenshots
are the most common thing to forget after a redesign, and they misrepresent the
version under review.

```bash
make build && make sim
bin/ciq-capture docs/store/screenshot.png --face --size 260 --mask
```

Generate the launcher icon and any hero image from the same geometry the face
uses, in a checked-in script, so they cannot drift from what the device renders.
Two things that bite when reusing face-drawing code for artwork:

- **Polarity must invert with the surface.** Face colours drawn on a hero's dark
  background paint dark-on-dark and vanish. Take colours as parameters.
- **Detail that sells at full size destroys legibility at icon size.** Ghost
  segments turn every digit into an `8` at 40px. Drop them there.

## Checklist

- [ ] `make test` passes, and the tests actually compile (`reference/testing.md`)
- [ ] `make lint` clean at level 3
- [ ] `make package` builds every declared device
- [ ] Developer key not committed
- [ ] Screenshots regenerated from this build
- [ ] Launcher icon is yours, at the size each device wants
- [ ] Listing states that settings are in the Garmin Connect app
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
