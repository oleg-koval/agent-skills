/*
 * Ambient types shared by kit.ts, paint.ts and stage.ts. This file is a script
 * (no import/export), so everything here is global. It is never shipped: the
 * three runtime scripts are type-stripped and loaded as classic <script> tags.
 */

type Pt = [number, number];
type Seed = number | string;
type Palette = Record<string, string>;
type Rng = () => number;

/* ---------- the timeline the CLI builds (window.SHORT) ---------- */

interface PaintLook {
  mode?: string;
  brush?: number; length?: number; layers?: number; swirl?: number; flow?: number; curve?: number;
  bristle?: number; impasto?: number; hueJitter?: number; valueJitter?: number; satJitter?: number;
  respect?: number; boil?: number; paper?: number; grain?: number; wash?: number; bleed?: number;
  outline?: number; ink?: string; paperColor?: string; posterize?: number; saturation?: number;
  contrast?: number; warmth?: number; vignette?: number; bloom?: number;
}

type PaintSettings = Required<PaintLook>;

type PaintNumberKey =
  | "brush" | "length" | "layers" | "swirl" | "flow" | "curve" | "bristle" | "impasto"
  | "hueJitter" | "valueJitter" | "satJitter" | "respect" | "boil" | "paper" | "grain"
  | "wash" | "bleed" | "outline" | "posterize" | "saturation" | "contrast" | "warmth"
  | "vignette" | "bloom";

interface Captions {
  style?: string; size?: number; weight?: number | string; font?: string; case?: string;
  width?: number; y?: number; box?: string; color?: string;
}

interface Look extends PaintLook {
  palette?: Palette;
  captions?: Captions;
}

interface Beat {
  line: number; scene: string; start: number; dur: number;
  move?: string; moveAmount?: number; seed?: Seed; transition?: string; fadeDur?: number;
  say?: string; caption?: string;
}

interface CaptionChunk { at: number; end: number; text: string }

interface Short {
  W: number; H: number; fps: number; twos: number; duration: number;
  beats: Beat[]; track?: CaptionChunk[]; voiceAt?: number[];
  look: Look; captions?: Captions;
}

/* ---------- options each kit helper takes (all optional unless marked) ---------- */

type SkyStop = string | [number, string];

interface SkyOpts { stops?: SkyStop[]; y0?: number; y1?: number }
interface CloudsOpts {
  y?: number; band?: number; n?: number; color?: string; shade?: string | null; size?: number;
  drift?: number; seed?: Seed; opacity?: number; perspective?: boolean;
}
interface SunOpts { x?: number; y?: number; r?: number; color?: string; glow?: string; glowSize?: number; glowAlpha?: number }
interface GlowOpts { x: number; y: number; r?: number; color?: string; a?: number }
interface StarsOpts { n?: number; y1?: number; color?: string; size?: number; seed?: Seed }
interface RaysOpts {
  x?: number; y?: number; angle?: number; spread?: number; n?: number; length?: number;
  color?: string; a?: number; width?: number;
}
interface RainOpts { n?: number; color?: string; a?: number; slant?: number; length?: number; speed?: number; seed?: Seed }
interface MotesOpts { n?: number; y0?: number; y1?: number; color?: string; r?: number; seed?: Seed }
interface HazeOpts { y?: number; h?: number; color?: string; a?: number }
interface RidgeOpts {
  y?: number; amp?: number; freq?: number; color?: string; shape?: string; seed?: Seed;
  to?: number; x0?: number; x1?: number; top?: string | null;
}
interface GroundOpts {
  y?: number; color?: string; far?: string | null; stripes?: number; stripe?: string | null;
  flowers?: number; flower?: string; seed?: Seed;
}
interface PathOpts { x?: number; y?: number; near?: number; far?: number; color?: string; to?: number; bend?: number }
interface WaterOpts {
  y0?: number; y1?: number; color?: string; deep?: string; glint?: string; glints?: number;
  seed?: Seed; speed?: number;
}
interface WaterfallOpts { x?: number; w?: number; y0?: number; y1?: number; color?: string; shade?: string; speed?: number }
interface TreeOpts {
  x?: number; y?: number; h?: number; kind?: string; crown?: string; trunk?: string;
  fruit?: string | null; seed?: Seed;
}
interface TreesOpts {
  n?: number; y?: number; h?: number; x0?: number; x1?: number; kind?: string; crown?: string;
  trunk?: string; jitter?: number; seed?: Seed;
}
interface FoliageOpts {
  side?: string; x?: number | null; y0?: number; y1?: number; depth?: number;
  color?: string; light?: string; seed?: Seed;
}
interface TrunksOpts {
  n?: number; color?: string; light?: string; y1?: number; seed?: Seed; x0?: number; x1?: number; width?: number;
}
interface HouseOpts {
  x?: number; y?: number; w?: number; h?: number; wall?: string; roof?: string; window?: string;
  lit?: boolean; litColor?: string; floors?: number; aFrame?: boolean;
}
interface CityOpts {
  y?: number; h?: number; color?: string; lit?: boolean; litColor?: string; density?: number;
  n?: number; seed?: Seed; x0?: number; x1?: number;
}
interface PagodaOpts { x?: number; y?: number; h?: number; color?: string; tiers?: number }
interface PoleOpts { x?: number; y?: number; h?: number; color?: string; wires?: number }
interface BlockOpts { x0: number; y0: number; x1: number; y1: number; color?: string; edge?: string | null; edgeWidth?: number }
interface LampOpts { x?: number; y?: number; h?: number; color?: string; light?: string; pool?: boolean }
interface ShapeOpts { pts: Pt[]; color?: string; smooth?: boolean }
interface HeartOpts { x?: number; y?: number; s?: number; color?: string }
interface PersonOpts {
  x?: number; y?: number; h?: number; pose?: string; facing?: string; hair?: string;
  skin?: string; hairColor?: string; top?: string; bottom?: string; shoes?: string;
  robe?: boolean; rim?: string | null; silhouette?: string | null; walk?: number; dx?: number;
  scale?: number; flip?: boolean; build?: number;
}

/* ---------- the kit a scene receives: (k) => { ... } ---------- */

interface Kit {
  g: CanvasRenderingContext2D;
  W: number; H: number; u: number; t: number; p: number;
  r: Rng;
  pal: Palette;
  beat: Beat;
  mix: (a: string, b: string, t: number) => string;
  alpha: (c: string, a: number) => string;
  rng: (seed: number) => Rng;
  noise1: (seed: number) => (x: number) => number;
  X: (x: number) => number;
  Y: (y: number) => number;
  sky: (o?: SkyOpts) => void;
  clouds: (o?: CloudsOpts) => void;
  sun: (o?: SunOpts) => void;
  glow: (o: GlowOpts) => void;
  stars: (o?: StarsOpts) => void;
  rays: (o?: RaysOpts) => void;
  rain: (o?: RainOpts) => void;
  motes: (o?: MotesOpts) => void;
  haze: (o?: HazeOpts) => void;
  ridge: (o?: RidgeOpts) => void;
  ground: (o?: GroundOpts) => void;
  path: (o?: PathOpts) => void;
  water: (o?: WaterOpts) => void;
  waterfall: (o?: WaterfallOpts) => void;
  tree: (o?: TreeOpts) => void;
  trees: (o?: TreesOpts) => void;
  foliage: (o?: FoliageOpts) => void;
  trunks: (o?: TrunksOpts) => void;
  house: (o?: HouseOpts) => void;
  city: (o?: CityOpts) => void;
  pagoda: (o?: PagodaOpts) => void;
  pole: (o?: PoleOpts) => void;
  block: (o: BlockOpts) => void;
  lamp: (o?: LampOpts) => void;
  shape: (o: ShapeOpts) => void;
  heart: (o?: HeartOpts) => void;
  person: (o?: PersonOpts) => void;
  people: (list: PersonOpts[]) => void;
}

type SceneFn = (k: Kit) => void;

interface ShortsKitApi {
  make: (
    g: CanvasRenderingContext2D, W: number, H: number, t: number, p: number,
    seed: number, pal: Palette | undefined, beat: Beat,
  ) => Kit;
  rng: (seed: number) => Rng;
  hashStr: (s: Seed) => number;
  mix: (a: string, b: string, t: number) => string;
  alpha: (c: string, a: number) => string;
}

interface Painter {
  paint: (flat: HTMLCanvasElement, look: PaintLook, tick: number) => void;
}

interface ShortsPaintApi {
  Painter: (canvas: HTMLCanvasElement) => Painter;
  DEFAULTS: PaintSettings;
}

interface Window {
  SHORT: Short;
  IMAGES: Record<string, HTMLImageElement>;
  SCENES: Record<string, SceneFn | undefined>;
  ShortsKit: ShortsKitApi;
  ShortsPaint: ShortsPaintApi;
  drawing: (d: number) => string;
  still: (i: number, at: number) => string;
  ready: boolean;
}
