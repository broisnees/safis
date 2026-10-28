// Build-time helpers for the captured figure images in public/media (see scripts/media.mjs).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.cwd(), "public/media");
// Width and height from a WebP file's header (lossy, lossless, and extended forms).
export function webpSize(file: string): [number, number] | null {
  if (!existsSync(file)) return null;
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return null;
}
export function media(name: string) {
  const size = webpSize(path.join(dir, `${name}.webp`));
  return { name, ok: !!size, w: size?.[0] ?? 1200, h: size?.[1] ?? 750, dark: existsSync(path.join(dir, `${name}-dark.webp`)) };
}
