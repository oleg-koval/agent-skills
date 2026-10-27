// `CM check`: catch what a render would get wrong, before paying for one. Each rule is a pure
// function over plain facts; the edge gathers the facts (the deck, the library, which files exist).
import { KINDS } from "./layout.ts";
import type { Deck, Slide } from "./types.ts";

export type Facts = { readonly deck: Deck; readonly library: readonly string[]; readonly files: readonly string[] };
export type Fit = { readonly slide: number; readonly overflow: boolean; readonly missingArt: boolean };
export type Finding = { readonly level: "error" | "warn"; readonly where: string; readonly msg: string };

const SLIDES = { min: 3, max: 10 };

const err = (where: string, msg: string): Finding => ({ level: "error", where, msg });
const warn = (where: string, msg: string): Finding => ({ level: "warn", where, msg });
const at = (i: number): string => `slide ${i + 1}`;
const words = (s: string | undefined): number => (s ? s.trim().split(/\s+/).length : 0);
const each = (deck: Deck, rule: (s: Slide, i: number) => readonly Finding[]): readonly Finding[] => deck.slides.flatMap(rule);

const unknownKinds = ({ deck }: Facts): readonly Finding[] =>
  each(deck, (s, i) => (KINDS[s.kind] ? [] : [err(at(i), `kind "${s.kind}" is not one of ${Object.keys(KINDS).join(", ")}`)]));

const deckSize = ({ deck: { slides } }: Facts): readonly Finding[] =>
  slides.length < SLIDES.min || slides.length > SLIDES.max ? [warn("deck", `${slides.length} slides; ${SLIDES.min} to ${SLIDES.max} read best`)] : [];

const shape = ({ deck: { slides } }: Facts): readonly Finding[] => [
  ...(slides[0]?.kind === "cover" ? [] : [warn(at(0), "the first slide should be a cover: it is the only one most people see")]),
  ...(slides.length < 2 || slides.at(-1)?.kind === "cta" ? [] : [warn(at(slides.length - 1), "the last slide should be a cta (save, follow, comment)")]),
];

const lengths = ({ deck }: Facts): readonly Finding[] =>
  each(deck, (s, i) => {
    const k = KINDS[s.kind];
    if (!k) return [];
    return [
      ...(words(s.title) > k.titleWords ? [warn(at(i), `title is ${words(s.title)} words; a ${s.kind} title fits ${k.titleWords}`)] : []),
      ...(words(s.body) > k.bodyWords ? [warn(at(i), `body is ${words(s.body)} words; a ${s.kind} body fits ${k.bodyWords}`)] : []),
    ];
  });

const missingArt = ({ deck, library, files }: Facts): readonly Finding[] => {
  const lib = new Set(library);
  const have = new Set(files);
  return each(deck, (s, i) =>
    s.art.kind === "library" && !lib.has(s.art.name)
      ? [err(at(i), `no drawing "${s.art.name}" in library/; add it to art/scenes.js and run CM art`)]
      : s.art.kind === "file" && !have.has(s.art.file)
        ? [err(at(i), `no file ${s.art.file}`)]
        : [],
  );
};

const repeatedArt = ({ deck }: Facts): readonly Finding[] => {
  const names = deck.slides.map((s) => (s.art.kind === "library" ? s.art.name : s.art.kind === "file" ? s.art.file : ""));
  return names.flatMap((n, i) => (n && names.indexOf(n) < i ? [warn(at(i), `repeats the picture of slide ${names.indexOf(n) + 1}`)] : []));
};

const RULES = [unknownKinds, missingArt, deckSize, shape, lengths, repeatedArt];

export const check = (facts: Facts): readonly Finding[] => RULES.flatMap((rule) => rule(facts));

/** What the browser measured after layout, as findings. */
export const fitFindings = (fit: readonly Fit[]): readonly Finding[] =>
  fit.flatMap((f) => [
    ...(f.overflow ? [err(`slide ${f.slide}`, "text spills out of the frame; shorten the title or body")] : []),
    ...(f.missingArt ? [err(`slide ${f.slide}`, "its picture did not load")] : []),
  ]);

export const report = (fs: readonly Finding[]): string =>
  fs.length === 0 ? "check: clean" : fs.map((f) => `${f.level === "error" ? "ERROR" : "warn "} ${f.where}: ${f.msg}`).join("\n");
