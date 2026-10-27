// The page a short is painted on: the runtime (type-stripped to classic scripts), the scenes, the assets.
// Everything is written under <project>/build so the skill folder itself stays read-only.
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonMap } from "../domain/types.ts";
import { openPage, type Page } from "./chrome.ts";
import { mkdir } from "./media.ts";

const RUNTIME = path.join(import.meta.dirname, "..", "runtime");
const SCRIPTS = ["kit", "paint", "stage"];
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const GPU = "(()=>{const c=document.createElement('canvas').getContext('webgl2');const d=c&&c.getExtension('WEBGL_debug_renderer_info');return c?c.getParameter(d?d.UNMASKED_RENDERER_WEBGL:c.RENDERER):'none'})()";

/** The browser loads these as classic scripts, so nothing may import or export. */
export function classicScript(file: string): string {
  const js = stripTypeScriptTypes(fs.readFileSync(file, "utf8"), { mode: "strip" });
  if (/^\s*(import|export)\s/m.test(js)) throw new Error(`${file}: import/export survives stripping`);
  return js;
}

const html = (state: JsonMap, imgs: readonly string[]): string => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head><body>
<canvas id="out"></canvas>
<script>window.SHORT=${JSON.stringify(state)};window.IMAGES={};</script>
<script src="kit.js"></script><script src="paint.js"></script><script src="scenes.js"></script>
<script>
Promise.all(${JSON.stringify(imgs)}.map(f=>new Promise(r=>{const i=new Image();i.onload=()=>{IMAGES[f.replace(/\\.[^.]+$/,"")]=i;r()};i.onerror=r;i.src="assets/"+f}))).then(()=>{const s=document.createElement("script");s.src="stage.js";document.body.appendChild(s)});
</script></body></html>`;

/** Writes build/index.html and what it loads. `state` becomes window.SHORT. */
export function buildPage(dir: string, state: JsonMap): string {
  const scenes = path.join(dir, "scenes.js");
  if (!fs.existsSync(scenes)) throw new Error("no scenes.js");
  const b = mkdir(dir, "build");
  SCRIPTS.forEach((n) => fs.writeFileSync(path.join(b, `${n}.js`), classicScript(path.join(RUNTIME, `${n}.ts`))));
  fs.copyFileSync(scenes, path.join(b, "scenes.js"));
  const assets = path.join(dir, "assets");
  const imgs = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => IMAGE.test(f)) : [];
  if (imgs.length) imgs.forEach((f) => fs.copyFileSync(path.join(assets, f), path.join(mkdir(b, "assets"), f)));
  const index = path.join(b, "index.html");
  fs.writeFileSync(index, html(state, imgs));
  return index;
}

export async function paintPage(dir: string, state: JsonMap, width: number, height: number): Promise<Page> {
  const pg = await openPage(pathToFileURL(buildPage(dir, state)).href, width, height);
  const gl = await pg.evaluate(GPU);
  if (/swiftshader|llvmpipe/i.test(String(gl))) console.log("· no GPU in this browser, painting on the CPU (slower, same picture)");
  return pg;
}

export const pageErrors = (pg: Page): readonly string[] => pg.logs().filter((l) => /error/i.test(l)).slice(0, 8);
