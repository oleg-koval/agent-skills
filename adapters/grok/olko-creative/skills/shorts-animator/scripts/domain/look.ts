import { isMap } from "./schema.ts";
import type { Json, JsonMap, Result, Short, Timeline } from "./types.ts";
import { fail, ok } from "./types.ts";

export type Named = (name: string) => Result<JsonMap>;

const sub = (o: JsonMap, k: string): JsonMap => {
  const v = o[k];
  return isMap(v) ? v : {};
};

/** A look is a name from looks/, or an object with an optional `base` name plus overrides. */
export function resolveLook(spec: Json, named: Named): Result<JsonMap> {
  if (typeof spec === "string") return named(spec || "oil");
  if (!isMap(spec)) return spec === null ? named("oil") : fail("look must be a name or an object");
  const base = typeof spec.base === "string" ? named(spec.base) : ok<JsonMap>({});
  if (!base.ok) return base;
  return ok({ ...base.value, ...spec, palette: { ...sub(base.value, "palette"), ...sub(spec, "palette") } });
}

/** What the page reads as window.SHORT: the timeline, the look with the short's palette over it, the captions. */
export const pageState = (s: Short, tl: Timeline, look: JsonMap) => ({
  ...tl,
  look: { ...look, ...(s.palette ? { palette: { ...sub(look, "palette"), ...s.palette } } : {}) },
  captions: { ...sub(look, "captions"), ...s.captions },
});
