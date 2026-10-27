/*
 * THE DRAWING KIT: what a scene is drawn with, flat, before the paint pass.
 *
 * A scene is a function (k) => { ... } that draws one shot. It gets:
 *   k.g        the 2D context, in frame pixels (k.W × k.H), camera applied
 *   k.W, k.H   the frame size; k.u = k.H / 1920 (so sizes read the same at any size)
 *   k.t        seconds into this shot (already on twos), k.p its progress 0→1
 *   k.r()      a random number, the same on every drawing of this shot
 *   k.pal      the short's palette (look.palette), k.beat the line being said
 * and every helper below. Helpers take an options object; anything left out
 * has a sensible default. Positions are fractions of the frame (x: 0.5 is the
 * middle, y: 0.7 is 70% down) unless a name ends in Px.
 *
 * Shapes are kept simple and readable, with clear silhouettes and big
 * value contrast: the paint pass adds the texture, so nothing here should.
 *
 * Every helper that draws randomly makes its own seeded rng from its seed, and
 * the order of those rng() calls is part of the picture: never reorder them.
 */
(function () {
  function rng(seed: number): Rng {
    let s = (seed >>> 0) || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  function hashStr(s: Seed): number {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  // smooth 1D noise for ridgelines
  function noise1(seed: number): (x: number) => number {
    const r = rng(seed), v = Array.from({ length: 512 }, r);
    return (x) => {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return v[i & 511] * (1 - u) + v[(i + 1) & 511] * u;
    };
  }
  function rgb(c: string): number[] {
    if (c.startsWith("rgb")) {
      const parts = c.match(/[\d.]+/g);
      if (!parts) throw new Error(`kit: cannot read colour "${c}"`);
      return parts.slice(0, 3).map(Number);
    }
    let h = c.replace("#", "");
    if (h.length === 3) h = [...h].map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a: string, b: string, t: number): string {
    const A = rgb(a), B = rgb(b);
    return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`;
  }
  function alpha(c: string, a: number): string {
    return `rgba(${rgb(c).join(",")},${a})`;
  }

  /** What every helper needs: the context (frame pixels), the frame, and the clock. */
  interface Ctx {
    g: CanvasRenderingContext2D;
    W: number; H: number; u: number; t: number; p: number;
    X: (x: number) => number;
    Y: (y: number) => number;
  }

  /* ---------- sky and light ---------- */

  /** A vertical gradient: stops = ["#top", "#mid", "#bottom"] or [[0,"#a"],[1,"#b"]]. */
  function sky({ g, W, H, Y }: Ctx, { stops = ["#8fb7e8", "#dfe9f2"], y0 = 0, y1 = 1 }: SkyOpts = {}): void {
    const gr = g.createLinearGradient(0, Y(y0), 0, Y(y1));
    stops.forEach((s, i) => {
      if (Array.isArray(s)) gr.addColorStop(s[0], s[1]);
      else gr.addColorStop(i / Math.max(1, stops.length - 1), s);
    });
    g.fillStyle = gr;
    g.fillRect(-W, Y(y0) - H, W * 3, Y(y1 - y0) + 2 * H);
  }

  function cloudPuffs(rr: Rng, cx: number, cy: number, w: number): [number, number, number][] {
    const puffs = 4 + Math.floor(rr() * 5);
    const P: [number, number, number][] = [];
    for (let j = 0; j < puffs; j++) P.push([cx + (rr() - 0.5) * w, cy + (rr() - 0.7) * w * 0.18, w * (0.12 + 0.14 * rr())]);
    return P;
  }

  /** Soft cumulus: clusters of ellipses in a band, drifting with t. */
  function clouds(
    { g, u, t, X, Y }: Ctx,
    { y = 0.04, band = 0.3, n = 26, color = "#ffffff", shade = "#c9d6e6", size = 1, drift = 6, seed: s = 1, opacity = 0.95, perspective = true }: CloudsOpts = {},
  ): void {
    const rr = rng(hashStr("clouds" + s));
    for (let i = 0; i < n; i++) {
      const f = rr();
      // nearer the horizon (lower in the band) they are smaller and flatter
      const depth = perspective ? 1 - f * 0.6 : 1;
      const cx = X(-0.15 + 1.3 * rr()) + t * drift * u * (0.6 + rr()) * depth;
      const cy = Y(y + band * f);
      const w = (70 + 170 * rr()) * size * u * depth;
      const P = cloudPuffs(rr, cx, cy, w);
      if (shade) {
        g.fillStyle = alpha(shade, opacity);
        for (const [px, py, pr] of P) { g.beginPath(); g.ellipse(px + pr * 0.15, py + pr * 0.3, pr * 1.25, pr * 0.55, 0, 0, 7); g.fill(); }
      }
      g.fillStyle = alpha(color, opacity);
      for (const [px, py, pr] of P) { g.beginPath(); g.ellipse(px, py, pr * 1.2, pr * 0.58, 0, 0, 7); g.fill(); }
    }
  }

  /** A disc with a glow: the sun, the moon, a street lamp's bulb. */
  function sun(
    { g, u, X, Y }: Ctx,
    { x = 0.7, y = 0.2, r: rad = 70, color = "#fff6d8", glow = "#ffe9a8", glowSize = 5, glowAlpha = 0.55 }: SunOpts = {},
  ): void {
    const R = rad * u;
    const gr = g.createRadialGradient(X(x), Y(y), R * 0.5, X(x), Y(y), R * glowSize);
    gr.addColorStop(0, alpha(glow, glowAlpha)); gr.addColorStop(1, alpha(glow, 0));
    g.fillStyle = gr; g.fillRect(X(x) - R * glowSize, Y(y) - R * glowSize, R * glowSize * 2, R * glowSize * 2);
    g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(y), R, 0, 7); g.fill();
  }

  /** A soft light anywhere (lamps, windows, fireflies, a candle). */
  function glow({ g, u, X, Y }: Ctx, { x, y, r: rad = 60, color = "#ffd27a", a = 0.8 }: GlowOpts): void {
    const R = rad * u;
    const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), R);
    gr.addColorStop(0, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
    g.fillStyle = gr; g.fillRect(X(x) - R, Y(y) - R, 2 * R, 2 * R);
  }

  /** Stars on a night sky, twinkling slowly. */
  function stars(
    { g, W, u, t, Y }: Ctx,
    { n = 120, y1 = 0.5, color = "#fffbe8", size = 2.4, seed: s = 3 }: StarsOpts = {},
  ): void {
    const rr = rng(hashStr("stars" + s));
    for (let i = 0; i < n; i++) {
      const x = rr() * W, y = rr() * Y(y1), tw = 0.5 + 0.5 * Math.sin(t * (1 + rr() * 2) + rr() * 6);
      g.fillStyle = alpha(color, 0.35 + 0.65 * tw * rr());
      g.beginPath(); g.arc(x, y, size * u * (0.4 + rr()), 0, 7); g.fill();
    }
  }

  /** Shafts of light, from a point, in a fan. */
  function rays(
    { g, H, u, X, Y }: Ctx,
    { x = 0.8, y = -0.05, angle = 115, spread = 22, n = 4, length = 1.4, color = "#fff3c4", a = 0.28, width = 60 }: RaysOpts = {},
  ): void {
    const rr = rng(hashStr("rays" + x + y));
    g.save();
    g.globalCompositeOperation = "screen";
    g.filter = `blur(${Math.round(18 * u)}px)`;
    for (let i = 0; i < n; i++) {
      const ang = ((angle + (i / Math.max(1, n - 1) - 0.5) * spread) * Math.PI) / 180;
      const w = width * u * (0.5 + rr());
      const L = length * H;
      const ex = X(x) + Math.cos(ang) * L, ey = Y(y) + Math.sin(ang) * L;
      const gr = g.createLinearGradient(X(x), Y(y), ex, ey);
      gr.addColorStop(0, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
      g.fillStyle = gr;
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      g.beginPath();
      g.moveTo(X(x) + nx * w * 0.2, Y(y) + ny * w * 0.2);
      g.lineTo(ex + nx * w, ey + ny * w);
      g.lineTo(ex - nx * w, ey - ny * w);
      g.lineTo(X(x) - nx * w * 0.2, Y(y) - ny * w * 0.2);
      g.fill();
    }
    g.restore();
  }

  /** Rain: slanted streaks that fall with t. */
  function rain(
    { g, W, H, u, t }: Ctx,
    { n = 260, color = "#dfe8f2", a = 0.45, slant = 0.18, length = 46, speed = 1, seed: s = 12 }: RainOpts = {},
  ): void {
    const rr = rng(hashStr("rain" + s));
    g.strokeStyle = alpha(color, a);
    g.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const L = length * u * (0.5 + rr()), sp = (1400 + rr() * 900) * u * speed;
      const x0 = rr() * W * 1.3 - W * 0.15, y0 = ((rr() * H * 1.2 + t * sp) % (H * 1.2)) - H * 0.1;
      g.lineWidth = (1.5 + rr() * 2) * u;
      g.beginPath(); g.moveTo(x0 - y0 * slant, y0); g.lineTo(x0 - (y0 + L) * slant, y0 + L); g.stroke();
    }
  }

  /** Small lights drifting: fireflies, embers, lanterns far off. */
  function motes(
    c: Ctx,
    { n = 24, y0 = 0.4, y1 = 0.9, color = "#ffcf6a", r: rad = 5, seed: s = 13 }: MotesOpts = {},
  ): void {
    const { g, u, t, X, Y } = c;
    const rr = rng(hashStr("motes" + s));
    for (let i = 0; i < n; i++) {
      const x = rr() + Math.sin(t * (0.3 + rr() * 0.4) + i) * 0.02, y = y0 + (y1 - y0) * rr() + Math.cos(t * 0.4 + i * 2) * 0.01;
      glow(c, { x, y, r: rad * 6, color, a: 0.35 });
      g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(y), rad * u, 0, 7); g.fill();
    }
  }

  /** A band of haze: lays air between planes, so distance reads. */
  function haze({ g, W, Y }: Ctx, { y = 0.5, h = 0.12, color = "#ffffff", a = 0.4 }: HazeOpts = {}): void {
    const gr = g.createLinearGradient(0, Y(y - h), 0, Y(y + h));
    gr.addColorStop(0, alpha(color, 0)); gr.addColorStop(0.5, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
    g.fillStyle = gr; g.fillRect(-W, Y(y - h), W * 3, Y(2 * h));
  }

  /* ---------- land ---------- */

  type RidgeHeight = (n: (x: number) => number, fx: number, freq: number) => number;
  const RIDGE_HEIGHT = new Map<string, RidgeHeight>([
    ["peaks", (n, fx, freq) => Math.pow(n(fx * freq), 1.6) * 1.4 + 0.25 * n(fx * freq * 4 + 9)],
    ["pines", (n, fx, freq) => {
      const cw = 1 / (freq * 4), ci = Math.floor(fx / cw), cf = (fx / cw) - ci;
      const ch = 0.55 + 0.45 * n(ci * 0.77 + 3);
      return 0.35 * n(fx * freq) + ch * (1 - Math.abs(cf - 0.5) * 2) * 0.9;
    }],
    ["bush", (n, fx, freq) => 0.5 * n(fx * freq) + 0.35 * Math.abs(Math.sin(fx * freq * 18 + n(fx * 30) * 3)) + 0.15 * n(fx * freq * 9)],
    ["rocky", (n, fx, freq) => n(fx * freq) * 0.8 + 0.3 * Math.abs(n(fx * freq * 6) - 0.5) * 2],
  ]);
  const ridgeSoft: RidgeHeight = (n, fx, freq) => n(fx * freq) * 0.85 + 0.15 * n(fx * freq * 3 + 4);

  /**
   * A ridge filled down to the bottom: hills, mountains, a far treeline.
   * shape: "soft" rolling, "peaks" mountains, "pines" a conifer line,
   * "bush" a broadleaf line, "rocky".
   */
  function ridge(
    { g, X, Y }: Ctx,
    { y = 0.55, amp = 0.06, freq = 3, color = "#3d6b3a", shape = "soft", seed: s = 1, to = 1.2, x0 = -0.2, x1 = 1.2, top = null }: RidgeOpts = {},
  ): void {
    const n = noise1(hashStr("ridge" + s + shape));
    if (top) {
      const gr = g.createLinearGradient(0, Y(y - amp), 0, Y(y + amp * 2));
      gr.addColorStop(0, top); gr.addColorStop(1, color);
      g.fillStyle = gr;
    } else g.fillStyle = color;
    const heightAt = RIDGE_HEIGHT.get(shape) ?? ridgeSoft;
    g.beginPath();
    g.moveTo(X(x0), Y(to));
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const fx = x0 + ((x1 - x0) * i) / steps;
      g.lineTo(X(fx), Y(y - amp * heightAt(n, fx, freq)));
    }
    g.lineTo(X(x1), Y(to));
    g.closePath();
    g.fill();
  }

  /** The ground plane from y down, with an optional gradient, mown stripes and flowers. */
  function ground(
    { g, W, H, u, X, Y }: Ctx,
    { y = 0.62, color = "#5d9a3b", far = null, stripes = 0, stripe = null, flowers = 0, flower = "#f7f3e6", seed: s = 2 }: GroundOpts = {},
  ): void {
    if (far) {
      const gr = g.createLinearGradient(0, Y(y), 0, H);
      gr.addColorStop(0, far); gr.addColorStop(1, color);
      g.fillStyle = gr;
    } else g.fillStyle = color;
    g.fillRect(-W, Y(y), W * 3, H * 2);
    if (stripes) {
      const rr = rng(hashStr("stripes" + s));
      for (let i = 0; i < stripes; i++) {
        const f = i / stripes;
        const yy = y + (1 - y) * Math.pow(f, 1.6);
        const hh = (1 - y) * (Math.pow((i + 1) / stripes, 1.6) - Math.pow(f, 1.6)) * 0.5;
        g.fillStyle = alpha(stripe || mix(color, "#000000", 0.12), 0.5 + 0.3 * rr());
        g.fillRect(-W, Y(yy), W * 3, Y(hh));
      }
    }
    if (flowers) {
      const rr = rng(hashStr("flowers" + s));
      for (let i = 0; i < flowers; i++) {
        const fy = y + (1 - y) * Math.pow(rr(), 0.7), sz = (2 + 7 * (fy - y) / (1 - y)) * u;
        g.fillStyle = alpha(flower, 0.85);
        g.beginPath(); g.arc(rr() * W, Y(fy), sz, 0, 7); g.fill();
      }
    }
  }

  /** A path or road narrowing to a vanishing point. */
  function path(
    { g, X, Y }: Ctx,
    { x = 0.5, y = 0.62, near = 0.5, far = 0.04, color = "#b59b72", to = 1.02, bend = 0 }: PathOpts = {},
  ): void {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(X(x - far / 2), Y(y));
    g.quadraticCurveTo(X(x - near / 4 + bend), Y((y + to) / 2), X(x - near / 2), Y(to));
    g.lineTo(X(x + near / 2), Y(to));
    g.quadraticCurveTo(X(x + near / 4 + bend), Y((y + to) / 2), X(x + far / 2), Y(y));
    g.closePath(); g.fill();
  }

  /* ---------- water ---------- */

  /** A lake or sea band, with sparkling horizontal glints that move. */
  function water(
    { g, W, u, t, Y }: Ctx,
    { y0 = 0.45, y1 = 0.62, color = "#2f8fc9", deep = "#1d5f97", glint = "#e9f6ff", glints = 90, seed: s = 4, speed = 1 }: WaterOpts = {},
  ): void {
    const gr = g.createLinearGradient(0, Y(y0), 0, Y(y1));
    gr.addColorStop(0, color); gr.addColorStop(1, deep);
    g.fillStyle = gr; g.fillRect(-W, Y(y0), W * 3, Y(y1 - y0));
    const rr = rng(hashStr("glint" + s));
    for (let i = 0; i < glints; i++) {
      const fy = rr(), yy = Y(y0 + (y1 - y0) * fy);
      const ph = rr() * 6.28, sp = (0.6 + rr()) * speed;
      const vis = 0.5 + 0.5 * Math.sin(t * 2.2 * sp + ph);
      const len = (14 + 60 * rr()) * u * (0.4 + fy);
      const xx = rr() * W + Math.sin(t * sp + ph) * 10 * u;
      g.fillStyle = alpha(glint, 0.25 + 0.6 * vis);
      g.fillRect(xx, yy, len, (2 + 3 * fy) * u);
    }
  }

  /** A falling column of water, with a churn of foam at its foot. */
  function waterfall(
    { g, H, u, t, X, Y }: Ctx,
    { x = 0.5, w = 0.2, y0 = 0.1, y1 = 0.7, color = "#e8f4f6", shade = "#a9cfd8", speed = 1 }: WaterfallOpts = {},
  ): void {
    g.fillStyle = shade; g.fillRect(X(x - w / 2), Y(y0), X(w), Y(y1 - y0));
    const rr = rng(hashStr("fall" + x));
    for (let i = 0; i < 26; i++) {
      const lx = X(x - w / 2) + rr() * X(w), lw = (4 + rr() * 16) * u;
      const off = ((t * 900 * speed * (0.7 + rr() * 0.6) * u + rr() * H) % (Y(y1 - y0)));
      g.fillStyle = alpha(color, 0.75);
      g.fillRect(lx, Y(y0), lw, Y(y1 - y0));
      g.fillStyle = alpha("#ffffff", 0.6);
      g.fillRect(lx, Y(y0) + off, lw, 40 * u);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = alpha("#ffffff", 0.7);
      g.beginPath();
      g.ellipse(X(x - w / 2 - 0.03) + rr() * X(w + 0.06), Y(y1) + (rr() - 0.3) * 30 * u, (30 + rr() * 50) * u, (10 + rr() * 16) * u, 0, 0, 7);
      g.fill();
    }
  }

  /* ---------- plants ---------- */

  /** Everything a tree kind needs: where it stands, its colours and its own rng. */
  interface TreeGeo {
    g: CanvasRenderingContext2D; u: number; rr: Rng; kind: string;
    cx: number; base: number; top: number; th: number; tw: number;
    trunk: string; crown: string; fruit: string | null;
  }

  // pine and column (cypress) are one shape with different width and tier count
  function drawConifer({ g, kind, cx, base, top, th, tw, crown }: TreeGeo): void {
    g.fillRect(cx - tw / 2, base, tw, th * 0.15);
    g.fillStyle = crown;
    const wide = kind === "column" ? 0.12 : 0.32;
    g.beginPath();
    g.moveTo(cx, top);
    const tiers = kind === "column" ? 1 : 5;
    for (let i = 1; i <= tiers; i++) {
      const yy = top - th * (i / tiers) * 0.92, ww = -th * wide * (i / tiers);
      g.lineTo(cx + ww, yy); g.lineTo(cx + ww * 0.45, yy - th * 0.04);
    }
    for (let i = tiers; i >= 1; i--) {
      const yy = top - th * (i / tiers) * 0.92, ww = -th * wide * (i / tiers);
      g.lineTo(cx - ww * 0.45, yy - th * 0.04); g.lineTo(cx - ww, yy);
    }
    g.closePath(); g.fill();
  }

  function drawBareTree({ g, u, rr, cx, base, th, tw, trunk }: TreeGeo): void {
    g.strokeStyle = trunk; g.lineCap = "round";
    const branch = (x0: number, y0: number, ang: number, len: number, wd: number, d: number): void => {
      if (d > 5 || len < 6 * u) return;
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.lineWidth = wd; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      branch(x1, y1, ang - 0.4 - rr() * 0.3, len * 0.72, wd * 0.68, d + 1);
      branch(x1, y1, ang + 0.4 + rr() * 0.3, len * 0.72, wd * 0.68, d + 1);
    };
    branch(cx, base, -Math.PI / 2, -th * 0.35, tw, 0);
  }

  function drawPalm({ g, u, cx, base, top, th, tw, trunk, crown }: TreeGeo): void {
    g.strokeStyle = trunk; g.lineWidth = tw; g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, base); g.quadraticCurveTo(cx + th * 0.1, base + th * 0.5, cx - th * 0.05, top); g.stroke();
    g.strokeStyle = crown; g.lineWidth = 10 * u;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath(); g.moveTo(cx - th * 0.05, top);
      g.quadraticCurveTo(cx - th * 0.05 + Math.cos(a) * -th * 0.2, top + Math.sin(a) * -th * 0.06 + th * 0.04, cx - th * 0.05 + Math.cos(a) * -th * 0.32, top - th * 0.1);
      g.stroke();
    }
  }

  // round / autumn: a cluster of blobs
  function drawRoundTree({ g, u, rr, kind, cx, top, th, crown, fruit }: TreeGeo): void {
    g.fillStyle = crown;
    const R = -th * 0.32;
    const ccy = top + R;
    for (let i = 0; i < 9; i++) {
      const a = rr() * 6.28, d = rr() * R * 0.6;
      g.beginPath(); g.arc(cx + Math.cos(a) * d, ccy + Math.sin(a) * d * 0.8, R * (0.45 + 0.3 * rr()), 0, 7); g.fill();
    }
    if (fruit || kind === "autumn") {
      g.fillStyle = fruit || "#e0862f";
      for (let i = 0; i < 40; i++) {
        const a = rr() * 6.28, d = rr() * R;
        g.beginPath(); g.arc(cx + Math.cos(a) * d, ccy + Math.sin(a) * d * 0.8, (3 + rr() * 5) * u, 0, 7); g.fill();
      }
    }
  }

  const TREE_DRAW = new Map<string, (t: TreeGeo) => void>([
    ["pine", drawConifer], ["column", drawConifer], ["bare", drawBareTree], ["palm", drawPalm],
  ]);

  /** One tree. kind: "round", "pine", "autumn", "bare", "palm", "column" (cypress). */
  function tree(
    { g, u, X, Y }: Ctx,
    { x = 0.5, y = 0.7, h = 0.3, kind = "round", crown = "#3f7d34", trunk = "#5b3b25", fruit = null, seed: s = 5 }: TreeOpts = {},
  ): void {
    const rr = rng(hashStr("tree" + s + x));
    const base = Y(y), top = Y(y - h), cx = X(x), th = (top - base);
    g.fillStyle = trunk;
    const tw = Math.max(6 * u, -th * 0.05);
    if (kind !== "pine" && kind !== "column") g.fillRect(cx - tw / 2, base + th * 0.55, tw, -th * 0.55);
    (TREE_DRAW.get(kind) ?? drawRoundTree)({ g, u, rr, kind, cx, base, top, th, tw, trunk, crown, fruit });
  }

  /** A row of trees along a line, sized by depth. */
  function trees(
    c: Ctx,
    { n = 6, y = 0.62, h = 0.18, x0 = 0, x1 = 1, kind = "round", crown = "#3f7d34", trunk = "#4a3020", jitter = 0.4, seed: s = 7 }: TreesOpts = {},
  ): void {
    const rr = rng(hashStr("trees" + s));
    for (let i = 0; i < n; i++) {
      const fx = x0 + ((x1 - x0) * (i + 0.5 + (rr() - 0.5) * jitter)) / n;
      tree(c, { x: fx, y: y + (rr() - 0.5) * 0.01, h: h * (0.75 + rr() * 0.5), kind, crown: mix(crown, "#000000", rr() * 0.18), trunk, seed: Number(s) * 31 + i });
    }
  }

  /** Foliage hanging into the frame from a side: a ragged, leafy mass. */
  function foliage(
    { g, W, u, X, Y }: Ctx,
    { side = "left", x = null, y0 = -0.05, y1 = 0.7, depth = 0.22, color = "#2f6a2c", light = "#5c9a3c", seed: s = 8 }: FoliageOpts = {},
  ): void {
    const rr = rng(hashStr("fol" + s + side));
    const edge = x ?? (side === "left" ? 0 : 1);
    const dir = side === "left" ? 1 : -1;
    const dark = mix(color, "#000000", 0.35);
    // the mass, then clumps of small leaves in three values, lit from the top
    g.fillStyle = dark;
    g.fillRect(side === "left" ? X(-0.3) : X(edge), Y(y0), X(0.3) + (side === "left" ? X(edge) : W), Y(y1 - y0));
    const clumps: [number, number, number][] = [];
    for (let i = 0; i < 46; i++) {
      const fy = y0 + (y1 - y0) * rr();
      const reach = depth * (0.35 + 0.65 * Math.sin(Math.PI * (fy - y0) / (y1 - y0))) * (0.55 + 0.6 * rr());
      clumps.push([X(edge + dir * reach * (0.55 + 0.45 * rr())), Y(fy), (30 + 50 * rr()) * u]);
    }
    const tones: [string, number, number][] = [[dark, 0, 30], [color, -0.25, 26], [light, -0.55, 12]];
    for (const [tone, shift, n] of tones) {
      g.fillStyle = tone;
      for (const [cx, cy, R] of clumps) {
        for (let j = 0; j < n; j++) {
          const a = rr() * 6.28, d = Math.sqrt(rr()) * R;
          const lx = cx + Math.cos(a) * d - dir * R * 0.2 * -shift, ly = cy + Math.sin(a) * d * 0.8 + R * shift;
          const lr = (5 + rr() * 9) * u;
          g.beginPath(); g.ellipse(lx, ly, lr * 1.5, lr, rr() * 3.14, 0, 7); g.fill();
        }
      }
    }
  }

  /** Tall trunks rising out of frame: a forest seen from inside. */
  function trunks(
    { g, H, X, Y }: Ctx,
    { n = 5, color = "#7a5534", light = "#a9784a", y1 = 1, seed: s = 9, x0 = 0, x1 = 1, width = 0.08 }: TrunksOpts = {},
  ): void {
    const rr = rng(hashStr("trunks" + s));
    for (let i = 0; i < n; i++) {
      const fx = x0 + ((x1 - x0) * (i + 0.2 + rr() * 0.6)) / n, w = X(width) * (0.6 + rr() * 0.7);
      g.fillStyle = color; g.fillRect(X(fx) - w / 2, -H, w, Y(y1) + H);
      g.fillStyle = light; g.fillRect(X(fx) - w / 2, -H, w * 0.28, Y(y1) + H);
    }
  }

  /* ---------- built things ---------- */

  function houseBody({ g, X, Y }: Ctx, o: Required<Pick<HouseOpts, "x" | "y" | "h" | "wall" | "roof" | "aFrame">>, L: number, R: number, T: number, B: number): void {
    const { x, y, h, wall, roof, aFrame } = o;
    g.fillStyle = wall;
    if (aFrame) {
      g.beginPath(); g.moveTo(L, B); g.lineTo(X(x), Y(y - h * 2)); g.lineTo(R, B); g.closePath(); g.fill();
    } else g.fillRect(L, T, R - L, B - T);
    g.fillStyle = roof;
    g.beginPath();
    if (aFrame) { g.moveTo(L - X(0.03), B); g.lineTo(X(x), Y(y - h * 2.15)); g.lineTo(R + X(0.03), B); g.lineTo(R, B); g.lineTo(X(x), Y(y - h * 1.95)); g.lineTo(L, B); }
    else { g.moveTo(L - X(0.02), T); g.lineTo(X(x), T - Y(h * 0.5)); g.lineTo(R + X(0.02), T); }
    g.closePath(); g.fill();
  }

  /** A house: box, pitched roof, windows (lit at night). */
  function house(
    c: Ctx,
    { x = 0.5, y = 0.7, w = 0.3, h = 0.16, wall = "#efe6d8", roof = "#3b3a45", window: windowColor = "#3c3b46", lit = false, litColor = "#ffcf6b", floors = 2, aFrame = false }: HouseOpts = {},
  ): void {
    const { g, W, H, X, Y } = c;
    const L = X(x - w / 2), R = X(x + w / 2), B = Y(y), T = Y(y - h);
    houseBody(c, { x, y, h, wall, roof, aFrame }, L, R, T, B);
    const cols = Math.max(2, Math.round(w / 0.07));
    const rows = aFrame ? 1 : floors;
    for (let ry = 0; ry < rows; ry++)
      for (let cx = 0; cx < cols; cx++) {
        const ww = ((R - L) / cols) * 0.42, wh = ((B - T) / rows) * 0.42;
        const wx = L + ((R - L) * (cx + 0.5)) / cols - ww / 2, wy = (aFrame ? B - (B - T) * 0.7 : T + ((B - T) * (ry + 0.5)) / rows - wh / 2);
        g.fillStyle = lit ? litColor : windowColor;
        g.fillRect(wx, wy, ww, wh);
        if (lit) glow(c, { x: (wx + ww / 2) / W, y: (wy + wh / 2) / H, r: 70, color: litColor, a: 0.35 });
      }
  }

  /** A skyline of towers; at night their windows are lit dots. */
  function city(
    { g, W, H, u, t, X, Y }: Ctx,
    { y = 0.62, h = 0.22, color = "#1b2740", lit = true, litColor = "#ffd66b", density = 0.35, n = 16, seed: s = 11, x0 = -0.05, x1 = 1.05 }: CityOpts = {},
  ): void {
    const rr = rng(hashStr("city" + s));
    const bw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const bx = x0 + i * bw + (rr() - 0.5) * bw * 0.4, bh = h * (0.35 + rr() * 0.75), ww = bw * (0.7 + rr() * 0.6);
      g.fillStyle = mix(color, "#000000", rr() * 0.25);
      g.fillRect(X(bx), Y(y - bh), X(ww), Y(bh) + 2);
      if (!lit) continue;
      const cols = Math.max(2, Math.round(ww * W / (14 * u))), rows = Math.round(bh * H / (18 * u));
      for (let ry = 1; ry < rows; ry++)
        for (let cx = 0; cx < cols; cx++) {
          if (rr() > density) continue;
          const on = Math.sin(t * 0.6 + i * 3 + ry * 7 + cx) > -0.85;
          if (!on) continue;
          g.fillStyle = alpha(litColor, 0.6 + rr() * 0.4);
          g.fillRect(X(bx) + (cx + 0.25) * (X(ww) / cols), Y(y - bh) + ry * (Y(bh) / rows), (X(ww) / cols) * 0.45, (Y(bh) / rows) * 0.4);
        }
    }
  }

  /** A pagoda or tower of stacked roofs. */
  function pagoda({ g, u, X, Y }: Ctx, { x = 0.5, y = 0.6, h = 0.3, color = "#3b2a22", tiers = 5 }: PagodaOpts = {}): void {
    g.fillStyle = color;
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers, w = X(0.16 * (1 - f * 0.6)), yy = Y(y - h * f);
      g.fillRect(X(x) - w * 0.32, yy - Y(h / tiers), w * 0.64, Y(h / tiers));
      g.beginPath(); g.moveTo(X(x) - w * 0.62, yy - Y(h / tiers) * 0.45); g.lineTo(X(x), yy - Y(h / tiers) * 1.05); g.lineTo(X(x) + w * 0.62, yy - Y(h / tiers) * 0.45); g.closePath(); g.fill();
    }
    g.fillRect(X(x) - 3 * u, Y(y - h) - Y(h * 0.18), 6 * u, Y(h * 0.18));
  }

  /** A utility pole with sagging wires running out of frame. */
  function pole({ g, u, X, Y }: Ctx, { x = 0.75, y = 0.75, h = 0.6, color = "#2a2626", wires = 3 }: PoleOpts = {}): void {
    g.fillStyle = color; g.fillRect(X(x) - 5 * u, Y(y - h), 10 * u, Y(h));
    g.fillRect(X(x) - 40 * u, Y(y - h) + 30 * u, 80 * u, 7 * u);
    g.strokeStyle = color; g.lineWidth = 2.5 * u;
    for (let i = 0; i < wires; i++) {
      const yy = Y(y - h) + 34 * u;
      const ex = -0.1, ey = yy + (i - 1) * 30 * u - 60 * u;
      g.beginPath(); g.moveTo(X(x) + (i - 1) * 35 * u, yy); g.quadraticCurveTo((X(x) + X(ex)) / 2, yy + 80 * u, X(ex), ey); g.stroke();
    }
  }

  /** A wall, a doorway or a block: any flat rectangle with a lit edge. */
  function block({ g, u, X, Y }: Ctx, { x0, y0, x1, y1, color = "#283a5a", edge = null, edgeWidth = 4 }: BlockOpts): void {
    g.fillStyle = color; g.fillRect(X(x0), Y(y0), X(x1 - x0), Y(y1 - y0));
    if (edge) { g.fillStyle = edge; g.fillRect(X(x0), Y(y0), edgeWidth * u, Y(y1 - y0)); }
  }

  /** A lamp post with its pool of light. */
  function lamp(c: Ctx, { x = 0.5, y = 0.8, h = 0.4, color = "#1d1d24", light = "#fff1c2", pool = true }: LampOpts = {}): void {
    const { g, u, X, Y } = c;
    g.fillStyle = color; g.fillRect(X(x) - 4 * u, Y(y - h), 8 * u, Y(h));
    sun(c, { x, y: y - h, r: 16, color: light, glow: light, glowSize: 9, glowAlpha: 0.4 });
    if (pool) {
      g.fillStyle = alpha(light, 0.16);
      g.beginPath(); g.ellipse(X(x), Y(y), 220 * u, 40 * u, 0, 0, 7); g.fill();
    }
  }

  /** Any closed shape from points [[x,y],...] (fractions); smooth: true rounds it. */
  function shape({ g, X, Y }: Ctx, { pts, color = "#000", smooth = false }: ShapeOpts): void {
    g.fillStyle = color; g.beginPath();
    if (!smooth) {
      pts.forEach(([x, y], i) => {
        if (i) g.lineTo(X(x), Y(y));
        else g.moveTo(X(x), Y(y));
      });
    } else {
      const P = pts.map(([x, y]) => [X(x), Y(y)]);
      g.moveTo((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2);
      for (let i = 1; i <= P.length; i++) {
        const a = P[i % P.length], b = P[(i + 1) % P.length];
        g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
    }
    g.closePath(); g.fill();
  }

  /** A heart (a pond, a sign, a balloon). */
  function heart({ g, X, Y }: Ctx, { x = 0.5, y = 0.5, s: size = 0.2, color = "#7ec8ef" }: HeartOpts = {}): void {
    const S = X(size), cx = X(x), cy = Y(y);
    g.fillStyle = color; g.beginPath();
    g.moveTo(cx, cy + S * 0.35);
    g.bezierCurveTo(cx - S * 0.9, cy - S * 0.1, cx - S * 0.45, cy - S * 0.62, cx, cy - S * 0.25);
    g.bezierCurveTo(cx + S * 0.45, cy - S * 0.62, cx + S * 0.9, cy - S * 0.1, cx, cy + S * 0.35);
    g.fill();
  }

  /* ---------- people ---------- */

  /** The figure being drawn: its context (maybe the rim layer), its unit U (a head) and its joints. */
  interface Fig {
    g: CanvasRenderingContext2D;
    c: (col: string) => string; // silhouette overrides every colour
    U: number; bw: number; t: number; ph: number;
    pose: string; facing: string; hair: string; robe: boolean; silhouette: string | null;
    skin: string; hairColor: string; top: string; bottom: string; shoes: string;
    hipY: number; shY: number; neckY: number;
  }

  // a tapered limb through three points
  function limb(g: CanvasRenderingContext2D, pts: Pt[], w0: number, w1: number, col: string): void {
    g.strokeStyle = col;
    for (let i = 0; i < pts.length - 1; i++) {
      g.lineWidth = w0 + (w1 - w0) * (i / Math.max(1, pts.length - 2));
      g.beginPath(); g.moveTo(...pts[i]); g.lineTo(...pts[i + 1]); g.stroke();
    }
  }

  /** Hip, knee and foot of one leg for a pose; s is -1 (left) or 1 (right). */
  type LegPose = (s: number, hx: number, hy: number, U: number, ph: number) => [Pt, Pt];
  const THIGH = 1.75, SHIN = 1.75;
  const walkAngles = (s: number, ph: number): Pt => {
    const q = ph + (s > 0 ? Math.PI : 0);
    return [Math.sin(q) * 0.36, Math.max(0, -Math.cos(q)) * 0.55];
  };
  const standLeg: LegPose = (s, hx, hy, U, ph) => {
    const thigh = U * THIGH, shin = U * SHIN;
    const [a, bend] = walkAngles(s, ph);
    const kx = hx + Math.sin(a) * thigh, ky = hy + Math.cos(a) * thigh;
    return [[kx, ky], [kx + Math.sin(a - bend) * shin, ky + Math.cos(a - bend) * shin]];
  };
  const idleLeg: LegPose = (_s, hx, hy, U) => {
    const ky = hy + U * THIGH;
    return [[hx, ky], [hx, ky + U * SHIN]];
  };
  const sitLeg: LegPose = (_s, hx, hy, U) => {
    const kx = hx + U * 1.7, ky = hy + U * 0.1;
    return [[kx, ky], [kx + U * 0.15, ky + U * SHIN]];
  };
  const kneelLeg: LegPose = (s, hx, hy, U) => {
    if (s < 0) {
      const kx = hx - U * 0.1, ky = hy + U * THIGH * 0.95;
      return [[kx, ky], [kx - U * 1.7, ky + U * 0.05]];
    }
    const kx = hx + U * 1.2, ky = hy + U * 1.0;
    return [[kx, ky], [kx, 0]];
  };
  const LEG_POSES = new Map<string, LegPose>([["sit", sitLeg], ["kneel", kneelLeg], ["walk", standLeg]]);

  function legs(f: Fig): void {
    const { g, c, U, bw, ph, pose, facing, robe, bottom, shoes, hipY } = f;
    if (robe && pose !== "walk" && pose !== "sit" && pose !== "kneel") return;
    const legPose = LEG_POSES.get(pose) ?? idleLeg;
    for (const s of [-1, 1]) {
      const hx = s * U * 0.42 * bw, hy = hipY + U * 0.2;
      const [[kx, ky], [fx, fy]] = legPose(s, hx, hy, U, ph);
      limb(g, [[hx, hy], [kx, ky], [fx, fy - U * 0.1]], U * 0.78 * bw, U * 0.56 * bw, c(bottom));
      g.fillStyle = c(shoes);
      g.beginPath(); g.ellipse(fx + (facing === "back" ? 0 : U * 0.08), fy - U * 0.1, U * 0.36, U * 0.2, 0, 0, 7); g.fill();
    }
  }

  // torso: rounded shoulders, a waist, the hips; a robe falls to the ankles
  function torso(f: Fig): void {
    const { g, c, U, bw, robe, silhouette, top, bottom, hipY, shY, neckY } = f;
    const sw = U * 1.05 * bw, ww = U * 0.78 * bw, hw = U * 0.86 * bw;
    g.fillStyle = c(top);
    g.beginPath();
    g.moveTo(-U * 0.3, neckY + U * 0.1);
    g.quadraticCurveTo(-sw, shY - U * 0.05, -sw, shY + U * 0.55);
    if (robe) {
      g.quadraticCurveTo(-ww, hipY, -hw * 1.35, -U * 0.15);
      g.lineTo(hw * 1.35, -U * 0.15);
      g.quadraticCurveTo(ww, hipY, sw, shY + U * 0.55);
    } else {
      g.quadraticCurveTo(-ww * 0.98, hipY - U * 0.9, -hw, hipY + U * 0.45);
      g.lineTo(hw, hipY + U * 0.45);
      g.quadraticCurveTo(ww * 0.98, hipY - U * 0.9, sw, shY + U * 0.55);
    }
    g.quadraticCurveTo(sw, shY - U * 0.05, U * 0.3, neckY + U * 0.1);
    g.closePath(); g.fill();
    if (!robe && !silhouette) { g.fillStyle = bottom; g.fillRect(-hw, hipY + U * 0.05, hw * 2, U * 0.45); }
  }

  // arms: [upper angle, forearm bend] in radians from hanging straight down, + = away from the body
  type ArmSet = [Pt, Pt];
  const ARM_POSES = new Map<string, ArmSet>([
    ["stand", [[0.1, 0.05], [0.1, 0.05]]], ["cheer", [[2.75, 0.15], [2.75, 0.15]]], ["open", [[1.45, 0.08], [1.45, 0.08]]],
    ["point", [[0.1, 0.05], [1.5, 0]]], ["reach", [[0.1, 0.05], [2.9, 0.05]]],
    ["pray", [[0.25, -1.9], [0.25, -1.9]]], ["hug", [[0.7, -1.6], [0.7, -1.6]]], ["sit", [[0.25, -0.9], [0.25, -0.9]]],
    ["kneel", [[0.15, -0.5], [0.15, -0.5]]], ["hold", [[0.12, -0.5], [0.12, -0.5]]],
  ]);
  const standArms: ArmSet = [[0.1, 0.05], [0.1, 0.05]];
  const ARM_ANIMATED = new Map<string, (t: number, ph: number) => ArmSet>([
    ["walk", (_t, ph) => { const sw = Math.sin(ph) * 0.38; return [[0.06 + sw, -0.15], [0.06 - sw, -0.15]]; }],
    ["wave", (t) => [[0.1, 0.05], [2.4, 0.55 + Math.sin(t * 8) * 0.35]]],
  ]);

  function arms(f: Fig): void {
    const { g, c, U, bw, t, ph, pose, skin, top, shY } = f;
    const upper = U * 1.5, fore = U * 1.4;
    const animated = ARM_ANIMATED.get(pose);
    const set = animated ? animated(t, ph) : ARM_POSES.get(pose) ?? standArms;
    [-1, 1].forEach((s, i) => {
      const [a1, a2] = set[i];
      const sx = s * U * 0.88 * bw, sy = shY + U * 0.45;
      const ex = sx + s * Math.sin(a1) * upper, ey = sy + Math.cos(a1) * upper;
      const a = a1 + a2;
      const hx = ex + s * Math.sin(a) * fore, hy = ey + Math.cos(a) * fore;
      limb(g, [[sx, sy], [ex, ey], [hx, hy]], U * 0.5 * bw, U * 0.4 * bw, c(top));
      g.fillStyle = c(skin);
      g.beginPath(); g.arc(hx, hy, U * 0.22, 0, 7); g.fill();
    });
  }

  /** What a hair style needs: the head centre height and radius, and whether we see the back. */
  interface HeadGeo { f: Fig; hy: number; hr: number; back: boolean }
  type HairStyle = (h: HeadGeo) => void;
  const PI = Math.PI;

  const curlyHair = (big: number): HairStyle => ({ f: { g }, hy, hr }) => {
    for (let i = 0; i < 11; i++) {
      const a = PI * 0.9 + (i / 10) * PI * 1.2;
      g.beginPath(); g.arc(Math.cos(a) * hr * 0.82 * big, hy - hr * 0.15 + Math.sin(a) * hr * 0.8 * big, hr * 0.36 * big, 0, 7); g.fill();
    }
  };
  const HAIR_STYLES = new Map<string, HairStyle>([
    ["short", ({ f: { g }, hy, hr }) => { g.beginPath(); g.ellipse(0, hy - hr * 0.25, hr * 0.92, hr * 0.8, 0, PI * 1.02, -0.02); g.fill(); }],
    ["long", ({ f: { g }, hy, hr }) => { g.beginPath(); g.ellipse(0, hy - hr * 0.2, hr * 0.98, hr * 0.88, 0, PI, 0); g.fill(); }],
    ["curly", curlyHair(1)],
    ["afro", curlyHair(1.35)],
    ["bun", ({ f: { g }, hy, hr }) => {
      g.beginPath(); g.ellipse(0, hy - hr * 0.25, hr * 0.92, hr * 0.78, 0, PI, 0); g.fill();
      g.beginPath(); g.arc(0, hy - hr * 1.05, hr * 0.4, 0, 7); g.fill();
    }],
    ["hood", ({ f: { g, c, top, skin }, hy, hr, back }) => {
      g.fillStyle = c(top); g.beginPath(); g.ellipse(0, hy, hr * 1.1, hr * 1.15, 0, 0, 7); g.fill();
      g.fillStyle = c(back ? top : skin); g.beginPath(); g.ellipse(0, hy + hr * 0.12, hr * 0.68, hr * 0.78, 0, 0, 7); g.fill();
    }],
    ["hat", ({ f: { g }, hy, hr }) => {
      g.beginPath(); g.moveTo(-hr * 2.1, hy - hr * 0.3); g.lineTo(0, hy - hr * 1.55); g.lineTo(hr * 2.1, hy - hr * 0.3); g.closePath(); g.fill();
    }],
    ["cap", ({ f: { g }, hy, hr }) => {
      g.beginPath(); g.ellipse(0, hy - hr * 0.3, hr * 0.95, hr * 0.75, 0, PI, 0); g.fill();
      g.fillRect(-hr * 0.2, hy - hr * 0.35, hr * 1.4, hr * 0.18);
    }],
  ]);

  function head(f: Fig): void {
    const { g, c, U, facing, hair, skin, hairColor, neckY } = f;
    g.fillStyle = c(skin);
    g.fillRect(-U * 0.2, neckY - U * 0.15, U * 0.4, U * 0.4);
    const hy = neckY - U * 0.62, hr = U * 0.58;
    const back = facing === "back";
    if (hair === "long") { g.fillStyle = c(hairColor); g.beginPath(); g.ellipse(0, hy + U * 0.55, hr * 1.02, U * 1.35, 0, 0, 7); g.fill(); }
    g.fillStyle = c(back && hair !== "bald" ? hairColor : skin);
    g.beginPath(); g.ellipse(0, hy, hr * 0.86, hr, 0, 0, 7); g.fill();
    g.fillStyle = c(hairColor);
    HAIR_STYLES.get(hair)?.({ f, hy, hr, back });
  }

  /** Where the figure's drawing goes: the frame itself, or a scratch layer when it has a rim light. */
  function figureLayer(target: CanvasRenderingContext2D, layer: HTMLCanvasElement): CanvasRenderingContext2D {
    layer.width = target.canvas.width; layer.height = target.canvas.height;
    const lg = layer.getContext("2d");
    if (!lg) throw new Error("kit: 2D canvas is not available for the rim layer");
    lg.setTransform(target.getTransform());
    return lg;
  }

  /** The rim: the figure's own outline, lit, then the figure over it. */
  function drawRim(target: CanvasRenderingContext2D, layer: HTMLCanvasElement, rim: string, u: number): void {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.shadowColor = rim; target.shadowBlur = 7 * u;
    for (const [ox, oy] of [[-2.5, 0], [2.5, 0], [0, -2.5]]) { target.shadowOffsetX = ox * u; target.shadowOffsetY = oy * u; target.drawImage(layer, 0, 0); }
    target.shadowColor = "transparent";
    target.drawImage(layer, 0, 0);
    target.restore();
  }

  /**
   * A person, flat and readable, head to feet h tall (fraction of frame),
   * feet at (x, y).
   *   pose: "stand" | "walk" | "cheer" (arms up) | "open" (arms out) | "sit" |
   *         "wave" | "point" | "kneel" | "pray" | "reach" (one arm up to the sky) | "hug"
   *   facing: "front" | "back" (no face drawn; the back of the head)
   *   hair: "short" | "long" | "curly" | "bun" | "afro" | "bald" | "hood" | "hat"
   *   skin, hairColor, top, bottom, shoes: colours
   *   robe: true draws a long garment to the ankles (in `top`)
   *   rim: a colour for a thin light around the figure (night scenes)
   *   silhouette: one colour for everything (backlit)
   *   walk: steps per second when pose is "walk"; dx moves the figure over the shot
   */
  function person(c: Ctx, scratch: { layer: HTMLCanvasElement | null }, o: PersonOpts = {}): void {
    const {
      x = 0.5, y = 0.85, h = 0.3, pose = "stand", facing = "front", hair = "short",
      skin = "#b9825a", hairColor = "#2a1d16", top = "#c9a27e", bottom = "#2c2a35", shoes = "#1d1a1a",
      robe = false, rim = null, silhouette = null, walk = 1.5, dx = 0, scale = 1, flip = false, build = 1,
    } = o;
    const { g: target, u, t, p, X, Y } = c;
    const layer = rim ? (scratch.layer ?? (scratch.layer = document.createElement("canvas"))) : null;
    const g = layer ? figureLayer(target, layer) : target;
    const U = (Y(h) * scale) / 7.4; // ~7.4 heads tall, measured in heads
    g.save();
    g.translate(X(x + dx * p), Y(y));
    if (flip) g.scale(-1, 1);
    g.lineCap = "round"; g.lineJoin = "round";
    const lift = pose === "kneel" ? U * 1.6 : pose === "sit" ? U * 1.9 : 0; // how far the hips drop
    const f: Fig = {
      g, c: (col) => silhouette || col, U, bw: build, t, ph: t * walk * Math.PI * 2,
      pose, facing, hair, robe, silhouette, skin, hairColor, top, bottom, shoes,
      hipY: -U * 3.55 + lift, shY: -U * 6.05 + lift, neckY: -U * 6.3 + lift,
    };
    // back-facing: arms behind the torso read wrong, so they go first only when facing away is false
    legs(f);
    if (facing === "back") { arms(f); torso(f); } else { torso(f); arms(f); }
    head(f);
    g.restore();
    if (layer && rim) drawRim(target, layer, rim, u);
  }

  /** Builds the kit for one drawing of one shot. */
  function make(g: CanvasRenderingContext2D, W: number, H: number, t: number, p: number, seed: number, pal: Palette | undefined, beat: Beat): Kit {
    const u = H / 1920;
    const X = (x: number) => x * W, Y = (y: number) => y * H;
    const c: Ctx = { g, W, H, u, t, p, X, Y };
    const scratch: { layer: HTMLCanvasElement | null } = { layer: null }; // the rim layer, made once per drawing
    return {
      g, W, H, u, t, p, r: rng(seed), pal: pal || {}, beat, mix, alpha, rng, noise1, X, Y,
      sky: (o) => sky(c, o), clouds: (o) => clouds(c, o), sun: (o) => sun(c, o), glow: (o) => glow(c, o),
      stars: (o) => stars(c, o), rays: (o) => rays(c, o), rain: (o) => rain(c, o), motes: (o) => motes(c, o),
      haze: (o) => haze(c, o), ridge: (o) => ridge(c, o), ground: (o) => ground(c, o), path: (o) => path(c, o),
      water: (o) => water(c, o), waterfall: (o) => waterfall(c, o), tree: (o) => tree(c, o), trees: (o) => trees(c, o),
      foliage: (o) => foliage(c, o), trunks: (o) => trunks(c, o), house: (o) => house(c, o), city: (o) => city(c, o),
      pagoda: (o) => pagoda(c, o), pole: (o) => pole(c, o), block: (o) => block(c, o), lamp: (o) => lamp(c, o),
      shape: (o) => shape(c, o), heart: (o) => heart(c, o), person: (o) => person(c, scratch, o),
      people: (list) => list.forEach((o) => person(c, scratch, o)),
    };
  }

  window.ShortsKit = { make, rng, hashStr, mix, alpha };
})();
