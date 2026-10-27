// The data a short is made of. Maps stay open: unknown keys pass through to the page untouched.

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
export type JsonMap = { readonly [k: string]: Json };

export type Shot = {
  readonly scene: string;
  readonly move?: string;
  readonly amount?: number;
  readonly seed?: number;
  readonly transition?: string;
};

export type Line = {
  readonly say: string;
  readonly speak?: string;
  readonly caption?: string;
  readonly shots: readonly Shot[];
  readonly move?: string;
  readonly amount?: number;
  readonly seed?: number;
  readonly hold?: number;
  readonly transition?: string;
};

export type Voice =
  | { readonly kind: "none" }
  | { readonly kind: "file"; readonly file: string }
  | { readonly kind: "kokoro"; readonly id: string; readonly speed: number };

export type Music = {
  readonly mood: string;
  readonly volume?: number;
  readonly seed?: number;
  readonly start?: number;
};

export type Short = {
  readonly title: string;
  readonly format: string;
  readonly fps: number;
  readonly twos: number;
  readonly lead: number;
  readonly pause: number;
  readonly tail: number;
  readonly transition: string;
  readonly look: Json;
  readonly palette?: JsonMap;
  readonly captions: JsonMap;
  readonly voice: Voice;
  readonly music: Music;
  readonly lines: readonly Line[];
};

/** One narrated line as the timeline needs it: how long it speaks, and where its audio comes from. */
export type Take = {
  readonly file: string | null;
  readonly dur: number;
  readonly from?: number;
  readonly slice?: boolean;
};

export type Beat = {
  readonly line: number;
  readonly scene: string;
  readonly start: number;
  readonly dur: number;
  readonly move: string;
  readonly moveAmount?: number;
  readonly seed?: number;
  readonly transition: string;
  readonly say: string;
};

export type Cue = { readonly at: number; readonly end: number; readonly text: string };

export type Timeline = {
  readonly W: number;
  readonly H: number;
  readonly fps: number;
  readonly twos: number;
  readonly duration: number;
  readonly beats: readonly Beat[];
  readonly track: readonly Cue[];
  readonly voiceAt: readonly number[];
};

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(...errors: readonly string[]): Result<T> => ({ ok: false, errors });
