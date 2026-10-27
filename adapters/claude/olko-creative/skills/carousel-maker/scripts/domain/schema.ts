// brand.json and decks/*.json arrive as unknown JSON; this is the one place they are narrowed.
import type { Art, Brand, Deck, Json, JsonMap, Result, Slide } from "./types.ts";
import { fail, ok } from "./types.ts";

export const isMap = (x: unknown): x is JsonMap => typeof x === "object" && x !== null && !Array.isArray(x);

const str = (o: JsonMap, k: string): string | undefined => {
  const v = o[k];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};
const map = (o: JsonMap, k: string): JsonMap => {
  const v = o[k];
  return isMap(v) ? v : {};
};

const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_COLORS = { paper: "#f4efe3", ink: "#1b1712", accent: "#e0783a", muted: "#6b6257" };
export const DEFAULT_FONTS = { head: "Georgia, serif", body: '"Helvetica Neue", Helvetica, Arial, sans-serif' };

export function parseBrand(raw: unknown): Result<Brand> {
  if (!isMap(raw)) return fail("brand.json is not an object");
  const c = map(raw, "colors");
  const f = map(raw, "fonts");
  const colors = {
    paper: str(c, "paper") ?? DEFAULT_COLORS.paper, ink: str(c, "ink") ?? DEFAULT_COLORS.ink,
    accent: str(c, "accent") ?? DEFAULT_COLORS.accent, muted: str(c, "muted") ?? DEFAULT_COLORS.muted,
  };
  const bad = Object.entries(colors).filter(([, v]) => !HEX.test(v)).map(([k, v]) => `colors.${k} "${v}" is not a #rrggbb colour`);
  const name = str(raw, "name");
  const errors = [...(name ? [] : ["brand.json needs a name"]), ...bad];
  if (errors.length > 0 || !name) return fail(...errors);
  return ok({ name, handle: str(raw, "handle") ?? "", colors, fonts: { head: str(f, "head") ?? DEFAULT_FONTS.head, body: str(f, "body") ?? DEFAULT_FONTS.body } });
}

/** A bare word is a library drawing; anything with a slash or an extension is a file. */
export const artOf = (x: Json | undefined): Art =>
  typeof x !== "string" || x.trim() === "" ? { kind: "none" } : /[/.]/.test(x) ? { kind: "file", file: x } : { kind: "library", name: x };

const slideOf = (x: Json, i: number): Result<Slide> => {
  if (!isMap(x)) return fail(`slides[${i}] is not an object`);
  const title = str(x, "title");
  if (!title) return fail(`slides[${i}] needs a title`);
  return ok({ kind: str(x, "kind") ?? "point", title, body: str(x, "body"), follow: str(x, "follow"), art: artOf(x["art"]) });
};

export function parseDeck(raw: unknown): Result<Deck> {
  if (!isMap(raw)) return fail("the deck is not an object");
  const list = raw["slides"];
  if (!Array.isArray(list) || list.length === 0) return fail("the deck needs a non-empty slides list");
  const parsed = list.map(slideOf);
  const errors = parsed.flatMap((r) => (r.ok ? [] : r.errors));
  const slides = parsed.flatMap((r) => (r.ok ? [r.value] : []));
  return errors.length > 0 ? fail(...errors) : ok({ title: str(raw, "title") ?? "carousel", caption: str(raw, "caption"), slides });
}
