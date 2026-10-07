import { realpathSync } from "node:fs";
import path from "node:path";

const DEFAULT_HIGHLIGHT_COLOR = "rgba(59, 130, 246, 0.3)";
const CHANNEL = String.raw`\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*`;
const ALPHA = String.raw`\s*(?:0|1|0?\.\d+|1\.0+)\s*`;
const COLOR_PATTERN = new RegExp(
  String.raw`^(?:rgb\(${CHANNEL},${CHANNEL},${CHANNEL}\)|rgba\(${CHANNEL},${CHANNEL},${CHANNEL},${ALPHA}\)|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$`,
);

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

export function resolveInsideWorkspace(root: string, filePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, filePath);
  return isInside(resolvedRoot, resolved) ? resolved : null;
}

/**
 * Like resolveInsideWorkspace, but also follows symlinks/junctions so a link
 * inside the workspace cannot point at a file outside it. The target must exist.
 */
export function resolveExistingInsideWorkspace(root: string, filePath: string): string | null {
  const lexical = resolveInsideWorkspace(root, filePath);
  if (!lexical) {
    return null;
  }
  try {
    const realRoot = realpathSync.native(path.resolve(root));
    const realTarget = realpathSync.native(lexical);
    return isInside(realRoot, realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}

export function toZeroBasedLine(protocolLine: number, lineCount: number): number {
  if (lineCount <= 0) {
    return 0;
  }
  const index = protocolLine - 1;
  if (index < 0) {
    return 0;
  }
  if (index >= lineCount) {
    return lineCount - 1;
  }
  return index;
}

export function toProtocolLine(zeroBasedLine: number): number {
  return zeroBasedLine + 1;
}

export function resolveHighlightColor(color: string | undefined): string {
  if (color !== undefined && COLOR_PATTERN.test(color.trim())) {
    return color.trim();
  }
  return DEFAULT_HIGHLIGHT_COLOR;
}
