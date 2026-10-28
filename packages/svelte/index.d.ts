import type { Component, Snippet } from "svelte";
import type { Color, FigureHandle, FigureSpec } from "@safis/core";
export { enhance, mount, typeset } from "@safis/core";

export const Figure: Component<{ spec: FigureSpec | (() => FigureSpec); id?: string; caption?: string | false; label?: string; wide?: boolean; class?: string; onready?: (handle: FigureHandle) => void }>;
export const Explainer: Component<{ as?: string; class?: string; children?: Snippet }>;
export const Scrub: Component<{ figure?: string; k: string }>;
export const SetLink: Component<{ figure?: string; values?: Record<string, string | number | boolean>; press?: string; play?: boolean; children?: Snippet }>;
export const Term: Component<{ color?: Color; part?: string; figure?: string; children?: Snippet }>;
export const Tex: Component<{ src: string; display?: boolean }>;
