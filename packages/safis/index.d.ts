// Types for the safis runtime. The runtime itself is plain JavaScript built from src/.
// Reference: skills/safis/references/runtime.md, plots.md, math.md, engine3d.md.

export type Point = [number, number];
export type Color = "ink" | "muted" | "faint" | "grid" | "panel" | "bg" | "brass" | "red" | "orange" | "green" | "blue" | "purple" | (string & {});
export type Values = Record<string, any>;

interface ControlBase {
  key?: string;
  label?: string;
  color?: Color;
  /** Keep the value but draw nothing in the panel (driven from the prose). */
  hidden?: boolean;
}
export interface SliderControl extends ControlBase {
  type?: "slider";
  key: string;
  min: number;
  max: number;
  step?: number;
  value?: number;
  unit?: string;
  format?: (value: number) => string;
  marks?: Array<number | { value: number; label?: string }>;
  snapToMarks?: boolean;
  /** Pixels of dragging a readout takes to cross the whole range [200]. */
  scrubPx?: number;
}
export interface ChoiceControl extends ControlBase {
  type: "choice";
  key: string;
  options: Array<string | number | { value: string | number; label?: string }>;
  value?: string | number;
}
export interface StepperControl extends ControlBase {
  type: "stepper";
  key: string;
  min: number;
  max: number;
  step?: number;
  value?: number;
  unit?: string;
  format?: (value: number) => string;
}
export interface KnobControl extends ControlBase {
  type: "knob";
  key: string;
  min: number;
  max: number;
  step?: number;
  value?: number;
  unit?: string;
  format?: (value: number) => string;
  /** max wraps round to min (angles). */
  wrap?: boolean;
}
export interface PadAxis { min: number; max: number; step?: number; unit?: string; format?: (value: number) => string }
export interface PadControl extends ControlBase {
  type: "pad";
  keys: [string, string];
  x: PadAxis;
  y: PadAxis;
  value?: [number, number];
}
export interface ToggleControl extends ControlBase {
  type: "toggle";
  key: string;
  value?: boolean;
}
export interface ButtonControl extends ControlBase {
  type: "button";
  label: string;
  primary?: boolean;
  action?: (s: any, v: Values, fig: FigureHandle) => void;
}
export type Control = SliderControl | ChoiceControl | StepperControl | KnobControl | PadControl | ToggleControl | ButtonControl;

export interface Preset {
  label: string;
  set?: Values;
  /** Label of a button to press. */
  press?: string;
  play?: boolean;
}

export interface FigureSpec<S = any> {
  draw(g: G, s: S, v: Values, fig: FigureHandle<S>): void;
  /** Width / height, or a function of the canvas width in CSS pixels. */
  aspect?: number | ((width: number) => number);
  state?: S | (() => S);
  controls?: Control[];
  presets?: Preset[];
  presetsLabel?: string;
  /** Caption text (HTML allowed); false for none. Defaults to the figure's aria-label. */
  caption?: string | false;
  change?(key: string, s: S, v: Values, fig: FigureHandle<S>): void;
  step?(dt: number, s: S, v: Values, fig: FigureHandle<S>): void;
  transport?: false | { step?: boolean; speed?: boolean };
  stepFrames?: number;
  autoplay?: boolean;
  playButton?: boolean;
  reset?: boolean | ((s: S, v: Values, fig: FigureHandle<S>) => void);
  drag?: {
    hit?(p: Point, s: S, v: Values, fig: FigureHandle<S>): any;
    start?(p: Point, s: S, v: Values, fig: FigureHandle<S>): void;
    move?(p: Point, s: S, v: Values, delta: Point, fig: FigureHandle<S>): void;
    end?(s: S, v: Values, fig: FigureHandle<S>): void;
  };
  orbit?: { yaw?: number; pitch?: number; minPitch?: number; maxPitch?: number; minYaw?: number; maxYaw?: number };
  hover?(p: Point | null, s: S, v: Values, fig: FigureHandle<S>): boolean | void;
  highlight?(name: string | null, s: S, v: Values, fig: FigureHandle<S>): void;
  status?(s: S, v: Values, fig: FigureHandle<S>): string;
  hints?: false | Array<[string, string]>;
  background?: Color;
}

export interface FigureHandle<S = any> {
  readonly id: string;
  readonly el: HTMLElement;
  readonly state: S;
  readonly values: Values;
  set(key: string, value: unknown): void;
  setMany(values: Values, options?: { animate?: boolean }): void;
  reset(): void;
  redraw(): void;
  play(on?: boolean): void;
  readonly playing: boolean;
  highlight: string | null;
  destroy(): void;
}

export interface TextOptions {
  color?: Color; size?: number; weight?: number | string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline;
  italic?: boolean; font?: "serif" | "mono" | (string & {}); halo?: boolean | Color; haloWidth?: number; alpha?: number;
  caps?: boolean; tracking?: number;
}
export interface ShapeOptions {
  stroke?: Color; fill?: Color; hatch?: boolean | Color; hatchGap?: number; hatchAngle?: number;
  width?: number; dash?: number[]; alpha?: number; close?: boolean; r?: number; head?: number;
}
export interface Mapping {
  (q: Point): Point;
  inv(p: Point): Point;
  sx: number;
  sy: number;
}
export interface View3D {
  project(p: [number, number, number]): [number, number, number];
  pick(p: Point, options?: { ghosts?: boolean }): { node: any; point: [number, number, number]; distance: number } | null;
  hidden(p: [number, number, number]): boolean;
  [key: string]: any;
}

/** The drawing context handed to draw(). Helpers from the plotting kit (g.graph, g.spring, g.atom, ...) and g.tex are typed loosely. */
export interface G {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  time: number;
  touched: boolean;
  highlight: string | null;
  color(name: Color): string;
  rgba(name: Color, alpha: number): string;
  mix(a: Color, b: Color, t: number): string;
  line(a: Point, b: Point, o?: ShapeOptions): void;
  path(points: Point[], o?: ShapeOptions): void;
  spline(points: Point[], o?: ShapeOptions & { steps?: number }): void;
  circle(c: Point, r: number, o?: ShapeOptions): void;
  rect(x: number, y: number, w: number, h: number, o?: ShapeOptions): void;
  arrow(a: Point, b: Point, o?: ShapeOptions): void;
  arcArrow(c: Point, r: number, a0: number, a1: number, o?: ShapeOptions): void;
  text(str: string | number, p: Point, o?: TextOptions): void;
  measure(str: string, o?: TextOptions): number;
  label(str: string, p: Point, o?: TextOptions): void;
  chip(str: string, p: Point, o?: { color?: Color; size?: number; padX?: number }): { w: number; h: number };
  callouts(items: Array<{ at: Point; text: string; color?: Color; side?: "left" | "right"; dy?: number }>, o?: { split?: number; size?: number; gap?: number; pad?: number; caps?: boolean }): void;
  dimension(a: Point, b: Point, text?: string, o?: { color?: Color; offset?: number; textColor?: Color }): void;
  meter(x: number, y: number, w: number, h: number, frac: number, o?: { color?: Color; label?: string }): void;
  dial(c: Point, r: number, value: number, o?: { min?: number; max?: number; ticks?: number; major?: number; label?: string; color?: Color }): void;
  field(fn: (x: number, y: number) => number, o?: Record<string, any>): void;
  colorbar(x: number, y: number, w: number, h: number, o?: Record<string, any>): void;
  inset(o: { from: Point; to: Point; radius?: number; zoom?: number }, draw: (g: G) => void): void;
  fit(x0: number, x1: number, y0: number, y1: number, o?: { box?: [number, number, number, number]; pad?: number; uniform?: boolean }): Mapping;
  axes(P: Mapping, o: Record<string, any>): void;
  clip(box: [number, number, number, number], fn: (g: G) => void): void;
  view3d(o?: Record<string, any>): any;
  render3d(scene: any, camera?: Record<string, any>, o?: { box?: [number, number, number, number] }): View3D;
  gizmo(view: View3D, o?: { at?: Point; size?: number }): void;
  handle(p: Point, o?: { color?: Color; r?: number; active?: boolean; hint?: boolean }): { at: Point; r: number };
  lit(name: string | string[]): boolean;
  tex?(src: string, p: Point, o?: TextOptions): { w: number; h: number };
  measureTex?(src: string, o?: TextOptions): { w: number; h: number; ascent: number; descent: number };
  graph?(o?: Record<string, any>): any;
  [helper: string]: any;
}

/** Turns a <figure> into a live figure. spec may be a function returning the spec (called in the browser). */
export function mount<S = any>(el: HTMLElement | string, spec: FigureSpec<S> | (() => FigureSpec<S>)): FigureHandle<S>;
export const demo: typeof mount;
/** Binds .scrub, .set and [data-part] elements under root to their figures. */
export function enhance(root?: ParentNode): void;
/** Typesets .tex elements under root as MathML; returns how many. */
export function typeset(root?: ParentNode): number;
export function toMathML(src: string, options?: { display?: boolean }): string;
/** "light" or "dark" forces a theme on <html>; "auto" follows the reader's setting. */
export function setTheme(mode: "light" | "dark" | "auto"): void;
/** Starts the runtime (it starts on import in a browser anyway) and returns window.Safis. */
export function ready(): any;
export const version: string;

/** The 3D engine (set in the browser). Reference: engine3d.md. */
export let E3: any;
/** Numerics: ODEs, roots, statistics, small linear algebra, softmax... (set in the browser). Reference: plots.md. */
export let Num: any;
/** Simulators: particles, rigid bodies, waves, grids, N-body, random walks, tiny neural nets (set in the browser). Reference: simulations.md. */
export let Sim: any;
/** Maps: projections, world land and borders, great circles, distances (set in the browser). Reference: maps.md. */
export let Geo: any;
/** Optics: 2D ray tracing through mirrors, lenses, prisms, drops, and eyes (set in the browser). Reference: optics.md. */
export let Optics: any;
/** Sound: Web Audio tones, harmonics, plucked strings, spectra (set in the browser). Reference: sound.md. */
export let Sound: any;
/** Images: pixel grids, convolution, sampling, color, dithering, DCT (set in the browser). Reference: images.md. */
export let Img: any;
/** Effects: WebGL fire, smoke, water, caustics, and glow drawn inside figures (set in the browser). Reference: effects.md. */
export let Fx: any;
/** Isometric technical illustration: solid parts with four-tone shading, painted back to front, exportable as SVG (set in the browser). Reference: iso.md. */
export let Iso: any;
export let SafisTeX: { toMathML(src: string, o?: { display?: boolean }): string; typeset(root?: ParentNode): number } | undefined;
/** Live palette colors by name (set in the browser). */
export let palette: Record<string, string>;

declare const _default: {
  mount: typeof mount; demo: typeof mount; enhance: typeof enhance; typeset: typeof typeset;
  toMathML: typeof toMathML; setTheme: typeof setTheme; ready: typeof ready; version: string;
};
export default _default;
