// `SA set dir key.path=value`: an immutable path update over plain JSON.
import { isJson, isMap } from "./schema.ts";
import type { Json, Result } from "./types.ts";
import { fail, ok } from "./types.ts";

export type Assignment = { readonly path: readonly string[]; readonly value: Json };

const parseValue = (raw: string): Json => {
  try {
    const v: unknown = JSON.parse(raw);
    return isJson(v) ? v : raw;
  } catch {
    return raw;
  }
};

/** "lines.0.say=Hello" becomes a path and a value; values are JSON when they parse, text otherwise. */
export function parseAssignment(arg: string): Result<Assignment> {
  const i = arg.indexOf("=");
  if (i <= 0) return fail(`"${arg}" is not key=value (e.g. look=watercolor, lines.0.hold=0.8)`);
  const path = arg.slice(0, i).split(".");
  if (path.some((k) => k === "")) return fail(`"${arg.slice(0, i)}" has an empty key`);
  return ok({ path, value: parseValue(arg.slice(i + 1)) });
}

const isIndex = (k: string): boolean => /^\d+$/.test(k);

export function setPath(doc: Json | undefined, path: readonly string[], value: Json): Json {
  const [k, ...rest] = path;
  if (k === undefined) return value;
  if (Array.isArray(doc) && isIndex(k)) {
    const i = Number(k);
    return Array.from({ length: Math.max(doc.length, i + 1) }, (_, j): Json => (j === i ? setPath(doc[j], rest, value) : (doc[j] ?? null)));
  }
  const base = isMap(doc) ? doc : {};
  const next = rest.length && base[k] === undefined && isIndex(rest[0] ?? "") ? [] : base[k];
  return { ...base, [k]: setPath(next, rest, value) };
}
