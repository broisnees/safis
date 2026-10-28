import type { CSSProperties, ElementType, MutableRefObject, ReactNode, JSX } from "react";
import type { Color, FigureHandle, FigureSpec } from "@safis/core";
export { enhance, mount, typeset } from "@safis/core";

export interface FigureProps<S = any> {
  /** The demo() spec, or a function returning it. Keep its identity stable. */
  spec: FigureSpec<S> | (() => FigureSpec<S>);
  id?: string;
  /** Caption under the plate (HTML allowed); false for none. */
  caption?: string | false;
  /** Describes the figure for screen readers; also the default caption. */
  label?: string;
  /** Break out of the text column. */
  wide?: boolean;
  className?: string;
  style?: CSSProperties;
  handleRef?: MutableRefObject<FigureHandle<S> | null>;
  onReady?: (handle: FigureHandle<S>) => void;
}
export function Figure<S = any>(props: FigureProps<S>): JSX.Element;
export function Explainer(props: { as?: ElementType; className?: string; children?: ReactNode; [attr: string]: any }): JSX.Element;
export function Scrub(props: { figure: string; k: string; className?: string }): JSX.Element;
export function SetLink(props: { figure: string; values?: Record<string, string | number | boolean>; press?: string; play?: boolean; className?: string; children?: ReactNode }): JSX.Element;
export function Term(props: { color?: Color; part?: string; figure?: string; className?: string; children?: ReactNode }): JSX.Element;
export function Tex(props: { src?: string; children?: string; display?: boolean; className?: string }): JSX.Element;
