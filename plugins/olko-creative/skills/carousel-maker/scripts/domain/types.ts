// The data a carousel is made of. Maps stay open: unknown keys are ignored, never rejected.

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
export type JsonMap = { readonly [k: string]: Json };

export type Brand = {
  readonly name: string;
  readonly handle: string;
  readonly colors: { readonly paper: string; readonly ink: string; readonly accent: string; readonly muted: string };
  readonly fonts: { readonly head: string; readonly body: string };
};

/** Where a slide's picture comes from: a drawing in the brand library, a file, or nothing. */
export type Art = { readonly kind: "none" } | { readonly kind: "library"; readonly name: string } | { readonly kind: "file"; readonly file: string };

export type Slide = {
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  readonly follow?: string;
  readonly art: Art;
};

export type Deck = {
  readonly title: string;
  readonly caption?: string;
  readonly slides: readonly Slide[];
};

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(...errors: readonly string[]): Result<T> => ({ ok: false, errors });
