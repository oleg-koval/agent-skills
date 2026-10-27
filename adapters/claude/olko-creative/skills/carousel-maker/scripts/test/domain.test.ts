import assert from "node:assert/strict";
import { test } from "node:test";
import { check, fitFindings, report, type Facts } from "../domain/check.ts";
import { contexts, esc, section } from "../domain/layout.ts";
import { artOf, parseBrand, parseDeck } from "../domain/schema.ts";
import type { Brand, Deck, Result } from "../domain/types.ts";

const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
};

const BRAND: Brand = value(parseBrand({ name: "Slow Hours", handle: "@slowhours" }));
const RAW = {
  title: "mornings",
  slides: [
    { kind: "cover", title: "Slow mornings, in 4 steps", body: "A calmer first hour.", art: "window" },
    { kind: "point", title: "Wake with the light", body: "Open the curtains.", art: "light" },
    { kind: "point", title: "Coffee, outside", art: "photos/mug.jpg" },
    { kind: "cta", title: "Save this for tomorrow", follow: "Follow @slowhours" },
  ],
};
const deck = (patch: object = {}): Deck => value(parseDeck({ ...RAW, ...patch }));
const facts = (d: Deck, library = ["window", "light"], files = ["photos/mug.jpg"]): Facts => ({ deck: d, library, files });
const msgs = (f: Facts, level: "error" | "warn"): readonly string[] => check(f).filter((x) => x.level === level).map((x) => `${x.where}: ${x.msg}`);

test("parseBrand fills default colours and fonts, and rejects a bad colour", () => {
  assert.equal(BRAND.colors.accent, "#e0783a");
  assert.match(BRAND.fonts.head, /Georgia/);
  assert.equal(parseBrand({ name: "x", colors: { accent: "orange" } }).ok, false);
  assert.equal(parseBrand({}).ok, false);
});

test("artOf tells a library drawing from a file from nothing", () => {
  assert.deepEqual(artOf("window"), { kind: "library", name: "window" });
  assert.deepEqual(artOf("photos/mug.jpg"), { kind: "file", file: "photos/mug.jpg" });
  assert.deepEqual(artOf(undefined), { kind: "none" });
  assert.deepEqual(artOf(""), { kind: "none" });
});

test("parseDeck defaults the kind to point and names every slide without a title", () => {
  assert.equal(deck({ slides: [{ title: "a" }] }).slides[0]?.kind, "point");
  const bad = parseDeck({ slides: [{ title: "a" }, {}, { kind: "cta" }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.ok ? [] : bad.errors, ["slides[1] needs a title", "slides[2] needs a title"]);
  assert.equal(parseDeck({ slides: [] }).ok, false);
});

test("a well-shaped deck with its art present checks clean", () => {
  assert.equal(report(check(facts(deck()))), "check: clean");
});

test("missing library drawings and files are errors", () => {
  const errors = msgs(facts(deck(), ["window"], []), "error");
  assert.ok(errors.some((m) => m.startsWith("slide 2") && m.includes('no drawing "light"')));
  assert.ok(errors.some((m) => m.startsWith("slide 3") && m.includes("no file photos/mug.jpg")));
});

test("an unknown kind is an error; a deck without a cover or cta is warned", () => {
  const d = deck({ slides: [{ kind: "quote", title: "a b" }, { kind: "point", title: "c d" }, { kind: "point", title: "e f" }] });
  assert.ok(msgs(facts(d), "error").some((m) => m.includes('kind "quote"')));
  const warns = msgs(facts(d), "warn");
  assert.ok(warns.some((m) => m.startsWith("slide 1") && m.includes("cover")));
  assert.ok(warns.some((m) => m.startsWith("slide 3") && m.includes("cta")));
});

test("long titles and repeated pictures are warned", () => {
  const d = deck({ slides: [
    { kind: "cover", title: "one two three four five six seven eight nine", art: "window" },
    { kind: "point", title: "short", art: "window" },
    { kind: "cta", title: "save" },
  ] });
  const warns = msgs(facts(d), "warn");
  assert.ok(warns.some((m) => m.includes("title is 9 words")));
  assert.ok(warns.some((m) => m.startsWith("slide 2") && m.includes("repeats the picture of slide 1")));
});

test("fitFindings turns the browser's measurements into errors", () => {
  const f = fitFindings([{ slide: 1, overflow: false, missingArt: false }, { slide: 2, overflow: true, missingArt: true }]);
  assert.deepEqual(f.map((x) => x.where), ["slide 2", "slide 2"]);
  assert.ok(f.every((x) => x.level === "error"));
});

test("points are numbered among points only, and the footer counts every slide", () => {
  const d = deck();
  const ctx = contexts(BRAND, d.slides, ["a.jpg", "b.jpg", "c.jpg", undefined]);
  assert.deepEqual(ctx.map((c) => c.point), [0, 1, 2, 2]);
  const html = ctx.map((c, i) => (d.slides[i] ? section(d.slides[i], c) : ""));
  assert.match(html[2] ?? "", /<div class="n">02<\/div>/);
  assert.match(html[0] ?? "", /swipe/);
  assert.match(html[3] ?? "", /4\/4/);
  assert.match(html[3] ?? "", /class="slide cta noart"/);
});

test("copy is escaped into the HTML", () => {
  assert.equal(esc(`<b>"x" & y</b>`), "&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
  const html = section({ kind: "point", title: "<script>", art: { kind: "none" } }, { brand: BRAND, n: 2, total: 3, point: 1 });
  assert.ok(!html.includes("<script>"));
});
