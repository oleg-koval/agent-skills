// A headless Chrome driven over the DevTools protocol with Node's own WebSocket and fetch:
// no puppeteer, nothing to npm install.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMap } from "../domain/schema.ts";
import type { Json, JsonMap } from "../domain/types.ts";

export type Chrome = { readonly bin: string; readonly shell: boolean };
export type Page = {
  readonly evaluate: (expression: string) => Promise<Json | undefined>;
  readonly logs: () => readonly string[];
  readonly close: () => void;
};

const SHELL = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
const SYSTEM: Readonly<Record<string, readonly string[]>> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  win32: [
    `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

const dirs = (d: string): readonly string[] =>
  fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) : [];

/** The headless shell HyperFrames downloads, newest first. */
const hyperframesShell = (): string | undefined =>
  dirs(path.join(os.homedir(), ".cache/hyperframes/chrome/chrome-headless-shell"))
    .toSorted()
    .reverse()
    .flatMap((v) => dirs(v).map((sub) => path.join(sub, SHELL)))
    .find((f) => fs.existsSync(f));

export function findChrome(): Chrome | undefined {
  const env = process.env.CHROME;
  if (env && fs.existsSync(env)) return { bin: env, shell: /headless-shell/.test(env) };
  const hf = hyperframesShell();
  if (hf) return { bin: hf, shell: true };
  const sys = (SYSTEM[process.platform] ?? []).find((c) => fs.existsSync(c));
  return sys ? { bin: sys, shell: false } : undefined;
}

const flags = (c: Chrome, profile: string, width: number, height: number): readonly string[] => {
  // the GPU through Metal on a Mac is ~15x faster than the software fallback
  const angle = process.env.SHORTS_GL || (process.platform === "darwin" ? "metal" : "");
  return [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--allow-file-access-from-files", "--hide-scrollbars", "--mute-audio", "--enable-webgl", "--ignore-gpu-blocklist",
    `--window-size=${width},${height}`, ...(c.shell ? [] : ["--headless=new"]), ...(angle ? [`--use-angle=${angle}`] : []), "about:blank",
  ];
};

const field = (o: Json | undefined, ...keys: readonly string[]): Json | undefined =>
  keys.reduce<Json | undefined>((v, k) => (isMap(v) ? v[k] : undefined), o);

const parse = (data: unknown): JsonMap | undefined => {
  try {
    const v: unknown = typeof data === "string" ? JSON.parse(data) : undefined;
    return isMap(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

/** What the page printed: console calls and uncaught exceptions. */
const logLine = (m: JsonMap): string | undefined => {
  if (m.method === "Runtime.consoleAPICalled") {
    const args = field(m, "params", "args");
    return Array.isArray(args) ? args.map((a) => String(field(a, "value") ?? field(a, "description") ?? "")).join(" ") : "";
  }
  if (m.method !== "Runtime.exceptionThrown") return undefined;
  return "ERROR " + String(field(m, "params", "exceptionDetails", "exception", "description") ?? field(m, "params", "exceptionDetails", "text") ?? "");
};

const devtoolsUrl = (proc: ReturnType<typeof spawn>): Promise<string> =>
  new Promise((resolve, reject) => {
    const seen: string[] = [];
    const to = setTimeout(() => reject(new Error("Chrome didn't start:\n" + seen.join("").slice(-800))), 30000);
    proc.stderr?.on("data", (d) => {
      seen.push(String(d));
      const m = seen.join("").match(/DevTools listening on (ws:\/\/\S+)/);
      if (m?.[1]) { clearTimeout(to); resolve(m[1]); }
    });
    proc.on("exit", (c) => { clearTimeout(to); reject(new Error(`Chrome exited (${c}):\n` + seen.join("").slice(-800))); });
  });

const pageSocketUrl = async (browserWs: string): Promise<string> => {
  const list: unknown = await (await fetch(`http://127.0.0.1:${new URL(browserWs).port}/json/list`)).json();
  const pg = Array.isArray(list) ? list.find((t) => isMap(t) && t.type === "page") : undefined;
  const url = isMap(pg) ? pg.webSocketDebuggerUrl : undefined;
  if (typeof url !== "string") throw new Error("Chrome opened no page");
  return url;
};

type Wire = { readonly send: (method: string, params?: JsonMap) => Promise<JsonMap>; readonly logs: () => readonly string[]; readonly ws: WebSocket };

/** The one stateful edge: replies waiting on an id, and the page's log. */
async function connect(url: string): Promise<Wire> {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const pending = new Map<number, (m: JsonMap) => void>();
  const logs: string[] = [];
  const ids = { next: 0 };
  ws.onmessage = (ev) => {
    const m = parse(ev.data);
    if (!m) return;
    const id = typeof m.id === "number" && pending.has(m.id) ? m.id : undefined;
    if (id !== undefined) { const reply = pending.get(id); pending.delete(id); reply?.(m); return; }
    const line = logLine(m);
    if (line !== undefined) logs.push(line);
  };
  const send = (method: string, params: JsonMap = {}) =>
    new Promise<JsonMap>((r) => {
      const id = ++ids.next;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, logs: () => logs, ws };
}

const evaluator = (send: Wire["send"]) => async (expression: string): Promise<Json | undefined> => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const ex = field(r, "result", "exceptionDetails");
  if (ex !== undefined) throw new Error(String(field(ex, "exception", "description") ?? field(ex, "text")));
  if (r.error !== undefined) throw new Error(String(field(r, "error", "message")));
  return field(r, "result", "result", "value");
};

async function waitFor(evaluate: Page["evaluate"], expr: string, deadline: number, logs: () => readonly string[]): Promise<void> {
  const ok = await evaluate(expr).catch(() => false);
  if (ok === true) return;
  if (Date.now() > deadline) throw new Error("The page didn't load:\n" + logs().join("\n"));
  await new Promise((r) => setTimeout(r, 100));
  return waitFor(evaluate, expr, deadline, logs);
}

export async function openPage(url: string, width: number, height: number, readyWhen = "window.ready === true"): Promise<Page> {
  const c = findChrome();
  if (!c) throw new Error("No Chrome found. Install Google Chrome, run `npx --yes hyperframes@0.8.150 browser ensure`, or set CHROME=/path/to/chrome");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-chrome-"));
  const proc = spawn(c.bin, flags(c, profile, width, height), { stdio: ["ignore", "ignore", "pipe"] });
  const close = () => {
    proc.kill("SIGKILL");
    // A killed Chrome can still be flushing its profile, so retry, and leave it to the OS if it will not go.
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      console.error(`· could not remove the browser profile at ${profile}`);
    }
  };
  try {
    const wire = await connect(await pageSocketUrl(await devtoolsUrl(proc)));
    await wire.send("Runtime.enable");
    await wire.send("Page.enable");
    await wire.send("Emulation.setDeviceMetricsOverride", { width: Math.min(width, 1600), height: Math.min(height, 1600), deviceScaleFactor: 1, mobile: false });
    await wire.send("Page.navigate", { url });
    const evaluate = evaluator(wire.send);
    await waitFor(evaluate, readyWhen, Date.now() + 30000, wire.logs);
    return { evaluate, logs: wire.logs, close: () => { wire.ws.close(); close(); } };
  } catch (e) {
    close();
    throw e;
  }
}
