/*
 * THE STAGE: which shot is on screen at a frame, the camera, the paint pass
 * and the caption. window.SHORT (the timeline the CLI builds) and
 * window.SCENES (the project's scenes.js) are loaded before this.
 *
 *   window.drawing(d) → paints drawing d (held `twos` frames) and returns it as a JPEG data URL
 *   window.still(i, at) → shot i at progress `at` (0..1), for contact sheets
 */
(function () {
  const S = window.SHORT;
  const { W, H, fps, twos } = S;

  function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const g = canvas.getContext("2d");
    if (!g) throw new Error("2D canvas is not available");
    return g;
  }

  function layer(): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    return { canvas, g: context2d(canvas) };
  }

  const { canvas: flat, g: fg } = layer();
  const { canvas: under, g: ug } = layer();
  const glc = document.createElement("canvas");
  glc.width = W; glc.height = H;
  const painter = window.ShortsPaint.Painter(glc);
  const out = document.getElementById("out");
  if (!(out instanceof HTMLCanvasElement)) throw new Error('no <canvas id="out"> on the page');
  out.width = W; out.height = H;
  const og = context2d(out);

  const ease = (x: number) => x * x * (3 - 2 * x);

  /** Scale and offset of the camera at progress eased e, strength a. */
  type CameraPose = (a: number, e: number, p: number) => [number, number, number];
  const CAMERA_MOVES = new Map<string, CameraPose>([
    ["push", (a, e) => [1 + 0.08 * a * e, 0, 0]],
    ["pull", (a, e) => [1 + 0.08 * a * (1 - e), 0, 0]],
    ["pan-left", (a, e) => [1.12, W * 0.05 * a * (1 - 2 * e), 0]],
    ["pan-right", (a, e) => [1.12, -W * 0.05 * a * (1 - 2 * e), 0]],
    ["rise", (a, e) => [1.1, 0, H * 0.04 * a * (1 - 2 * e)]],
    ["fall", (a, e) => [1.1, 0, -H * 0.04 * a * (1 - 2 * e)]],
    ["drift", (a, _e, p) => [1.05, W * 0.015 * a * Math.sin(p * 2.2), H * 0.008 * a * Math.cos(p * 1.7)]],
  ]);

  /** The camera, as a transform about the frame centre. Moves are slow on purpose. */
  function camera(g: CanvasRenderingContext2D, move: string | undefined, p: number, amount: number | undefined): void {
    const a = amount ?? 1;
    const e = ease(Math.min(1, Math.max(0, p)));
    const [s, x, y] = (move === undefined ? undefined : CAMERA_MOVES.get(move))?.(a, e, p) ?? [1, 0, 0];
    g.setTransform(s, 0, 0, s, W / 2 - (W / 2) * s + x, H / 2 - (H / 2) * s + y);
  }

  function drawMissingScene(g: CanvasRenderingContext2D, name: string): void {
    g.fillStyle = "#c33"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.font = `${60 * H / 1920}px sans-serif`;
    g.fillText(`no scene "${name}"`, 40, H / 2);
    console.error(`no scene "${name}" in scenes.js`);
  }

  function drawBeat(g: CanvasRenderingContext2D, i: number, t: number): void {
    const b = S.beats[i];
    const fn = window.SCENES[b.scene];
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    camera(g, b.move, t / b.dur, b.moveAmount);
    if (!fn) drawMissingScene(g, b.scene);
    else {
      const k = window.ShortsKit.make(g, W, H, t, Math.min(1, t / b.dur), window.ShortsKit.hashStr(b.scene + (b.seed ?? "")), S.look.palette, b);
      try { fn(k); } catch (e) { console.error(`scene "${b.scene}": ${e instanceof Error ? e.message : String(e)}`); }
    }
    g.restore();
  }

  function beatAt(time: number): number {
    let i = 0;
    while (i < S.beats.length - 1 && time >= S.beats[i + 1].start) i++;
    return i;
  }

  function captionText(text: string, C: Captions): string {
    return C.case === "upper" ? text.toUpperCase() : C.case === "lower" ? text.toLowerCase() : text;
  }

  function caption(text: string): void {
    const C = S.captions || {};
    if (!text || C.style === "none") return;
    const size = (C.size ?? 44) * (H / 1920) * (W > H ? 1.25 : 1);
    og.font = `${C.weight ?? 500} ${size}px ${C.font ?? '"Helvetica Neue", Helvetica, Arial, sans-serif'}`;
    og.textAlign = "center";
    og.textBaseline = "middle";
    const lines = wrap(captionText(text, C), W * (C.width ?? 0.78), og);
    const lh = size * 1.3;
    const y0 = H * (C.y ?? 0.775) - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, j) => {
      const y = y0 + j * lh;
      if ((C.style ?? "box") === "box") {
        const w = og.measureText(ln).width + size * 0.7;
        og.fillStyle = C.box ?? "rgba(20,20,20,0.62)";
        og.fillRect(W / 2 - w / 2, y - lh / 2 + size * 0.04, w, lh - size * 0.08);
      } else {
        og.shadowColor = "rgba(0,0,0,0.75)";
        og.shadowBlur = size * 0.35;
      }
      og.fillStyle = C.color ?? "#ffffff";
      og.fillText(ln, W / 2, y + size * 0.04);
      og.shadowBlur = 0;
    });
  }

  function wrap(text: string, max: number, g: CanvasRenderingContext2D): string[] {
    const words = text.split(/\s+/), lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (g.measureText(next).width > max && cur) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** The words on screen at a time: the caption track (chunks of the line, timed to the voice). */
  function captionFor(time: number, b: Beat): string {
    if (S.track) {
      for (const c of S.track) if (time >= c.at && time < c.end) return c.text;
      return "";
    }
    return b.caption ?? b.say ?? "";
  }

  /** How long the soft cut into this shot lasts: "fade" or "dip", else none. */
  function fadeFor(b: Beat): number {
    return b.transition === "fade" ? (b.fadeDur ?? 0.5) : b.transition === "dip" ? (b.fadeDur ?? 0.7) : 0;
  }

  // a soft cut: the end of the previous shot fades under this one ("fade"), or through black ("dip")
  function softCut(i: number, b: Beat, t: number, fade: number): void {
    const prev = S.beats[i - 1];
    fg.save();
    if (b.transition === "dip") {
      fg.globalAlpha = 1 - t / fade;
      fg.fillStyle = "#000";
      fg.fillRect(0, 0, W, H);
    } else {
      drawBeat(ug, i - 1, prev.dur);
      fg.globalAlpha = 1 - t / fade;
      fg.drawImage(under, 0, 0);
    }
    fg.restore();
  }

  function render(time: number, tick: number): void {
    const i = beatAt(time);
    const b = S.beats[i];
    const t = time - b.start;
    drawBeat(fg, i, t);
    const fade = fadeFor(b);
    if (fade && i > 0 && t < fade) softCut(i, b, t, fade);
    painter.paint(flat, S.look, tick);
    og.drawImage(glc, 0, 0);
    caption(captionFor(time, b));
  }

  window.drawing = (d) => {
    const time = (d * twos) / fps + 0.0001;
    render(time, d);
    return out.toDataURL("image/jpeg", 0.93);
  };
  window.still = (i, at) => {
    const b = S.beats[i];
    const time = b.start + b.dur * at;
    render(time, Math.round((time * fps) / twos));
    return out.toDataURL("image/jpeg", 0.9);
  };
  window.ready = true;
})();
