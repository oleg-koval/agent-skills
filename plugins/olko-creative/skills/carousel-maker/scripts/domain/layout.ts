// The brand template: one fixed 1080x1350 layout per slide kind, filled from the deck. Pure strings;
// the edge decides where the HTML goes and resolves each picture to a URL first.
import type { Brand, Slide } from "./types.ts";

export const W = 1080;
export const H = 1350;

export type Ctx = { readonly brand: Brand; readonly n: number; readonly total: number; readonly point: number; readonly src?: string };
type Kind = { readonly titleWords: number; readonly bodyWords: number; readonly render: (s: Slide, c: Ctx) => string };

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const img = (c: Ctx): string => (c.src ? `<img class="art" src="${esc(c.src)}">` : "");
const para = (text: string | undefined, cls = "body"): string => (text ? `<p class="${cls}">${esc(text)}</p>` : "");
const BOOKMARK = (b: Brand): string =>
  `<svg class="mark" width="150" height="190" viewBox="0 0 150 190"><path d="M14 10h122v170l-61-44-61 44z" fill="${b.colors.accent}" stroke="${b.colors.ink}" stroke-width="8" stroke-linejoin="round"/></svg>`;

export const KINDS: Readonly<Record<string, Kind>> = {
  cover: { titleWords: 8, bodyWords: 14, render: (s, c) => `${img(c)}<h1>${esc(s.title)}</h1>${para(s.body)}` },
  point: {
    titleWords: 7, bodyWords: 22,
    render: (s, c) => `<div class="n">${String(c.point).padStart(2, "0")}</div><h1>${esc(s.title)}</h1>${para(s.body)}${img(c)}`,
  },
  cta: { titleWords: 6, bodyWords: 14, render: (s, c) => `${c.src ? img(c) : BOOKMARK(c.brand)}<h1>${esc(s.title)}</h1>${para(s.body)}${para(s.follow, "body follow")}` },
};

export const css = ({ colors: k, fonts: f }: Brand): string => `
*{margin:0;box-sizing:border-box}
body{background:${k.paper}}
.slide{width:${W}px;height:${H}px;background:${k.paper};color:${k.ink};font-family:${f.body};
  padding:80px 84px 64px;display:flex;flex-direction:column;overflow:hidden;position:relative}
h1{font-family:${f.head};font-weight:700;letter-spacing:-1.5px;line-height:1.02;text-wrap:balance;overflow-wrap:normal}
.art{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:28px;border:4px solid ${k.ink}}
.n{font-family:${f.head};font-weight:700;font-size:56px;color:${k.accent};margin-bottom:12px}
.body{font-size:34px;line-height:1.35;color:${k.muted};margin-top:18px;text-wrap:pretty}
.foot{margin-top:auto;display:flex;justify-content:space-between;font-size:26px;font-weight:600;color:${k.muted};padding-top:28px}
.swipe{color:${k.accent}}
.cover h1{font-size:92px;margin-top:44px}
.cover .art{width:760px;margin:0 auto}
.point h1{font-size:76px}
.point .art{width:800px;margin:44px auto 0}
.cta{justify-content:center;text-align:center}
.cta .mark{margin:auto auto 0}
.cta .art{width:520px;margin:auto auto 0}
.cta h1{font-size:104px;margin-top:56px}
.cta .follow{color:${k.ink};font-weight:600;margin-bottom:auto}
.noart.cover h1{font-size:128px;margin-top:auto}
.noart.point h1{font-size:104px;margin-top:40px}
.noart.point .body{font-size:44px;margin-top:36px}
`;

const foot = (c: Ctx): string =>
  `<div class="foot"><span>${esc(c.brand.handle)}</span><span>${c.n === 1 ? '<span class="swipe">swipe &rarr;</span>' : `${c.n}/${c.total}`}</span></div>`;

/** One slide's section; an unknown kind renders as a point so a typo never blanks a slide. */
export const section = (s: Slide, c: Ctx): string => {
  const kind = KINDS[s.kind] ? s.kind : "point";
  const body = (KINDS[kind] ?? KINDS["point"])?.render(s, c) ?? "";
  return `<section class="slide ${kind}${c.src ? "" : " noart"}">${body}${foot(c)}</section>`;
};

/** The context of every slide: its place in the deck, its point number, its picture. */
export const contexts = (brand: Brand, slides: readonly Slide[], srcs: readonly (string | undefined)[]): readonly Ctx[] =>
  slides.map((s, i) => ({
    brand, n: i + 1, total: slides.length, src: srcs[i],
    point: slides.slice(0, i + 1).filter((x) => x.kind === "point" || !KINDS[x.kind]).length,
  }));

export const page = (brand: Brand, body: string, script = ""): string =>
  `<!doctype html><meta charset="utf-8"><style>${css(brand)}</style><body>${body}${script}</body>`;

/** Runs in the browser after layout: which slides spill out of their frame or lost their picture. */
export const MEASURE = `<script>addEventListener("load",()=>{const r=[...document.querySelectorAll(".slide")].map((s,i)=>({slide:i+1,
overflow:s.scrollHeight>s.clientHeight+1||s.scrollWidth>s.clientWidth+1||[...s.querySelectorAll("h1,p")].some(e=>e.scrollWidth>e.clientWidth+1),
missingArt:[...s.querySelectorAll("img")].some(i=>!i.complete||i.naturalWidth===0)}));
const p=document.createElement("pre");p.id="fit";p.textContent=JSON.stringify(r);document.body.append(p)})</script>`;
