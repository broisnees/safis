import type { DefineComponent } from "vue";
import type { Color, FigureSpec } from "@safis/core";
export { enhance, mount, typeset } from "@safis/core";

export const Figure: DefineComponent<{ spec: FigureSpec | (() => FigureSpec); id?: string; caption?: string | false; label?: string; wide?: boolean }>;
export const Explainer: DefineComponent<{ as?: string }>;
export const Scrub: DefineComponent<{ figure?: string; k: string }>;
export const SetLink: DefineComponent<{ figure?: string; values?: Record<string, string | number | boolean>; press?: string; play?: boolean }>;
export const Term: DefineComponent<{ color?: Color; part?: string; figure?: string }>;
export const Tex: DefineComponent<{ src?: string; display?: boolean }>;
