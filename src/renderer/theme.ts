import type { ThemeMode, ThemeState } from "@shared/types";
import { appStore } from "./app-store";

/**
 * Renderer theme helpers: the 18 accent presets and the CSS-variable
 * injection that drives the app's color accent (mirrors the prototype's
 * `applyThemeAccent`). Mode persistence lives in the main process
 * (`theme:set` → nativeTheme), the renderer only re-applies the attribute
 * for explicit light/dark and lets `prefers-color-scheme` do the rest.
 */

export interface ThemeColor {
  id: string;
  hex: string;
}

export const THEME_COLORS: ThemeColor[] = [
  // Private layer: the first preset is also the app default (see
  // src/main/theme.ts DEFAULT_COLOR). A calm pine green reads well on both the
  // light and the dark surface, where the stock #07C160 is very loud.
  { id: "Emerald", hex: "#31895F" },
  { id: "Ocean", hex: "#3370FF" },
  { id: "Amber", hex: "#F58220" },
  { id: "Rose", hex: "#FA5151" },
  { id: "Lavender", hex: "#8B5CF6" },
  { id: "Teal", hex: "#0EA5E9" },
  { id: "Pink", hex: "#F472B6" },
  { id: "Slate", hex: "#64748B" },
  { id: "Forest", hex: "#22C55E" },
  { id: "Cobalt", hex: "#2563EB" },
  { id: "Coral", hex: "#FF6B6B" },
  { id: "Indigo", hex: "#4F46E5" },
  { id: "Gold", hex: "#D9A200" },
  { id: "Copper", hex: "#C2410C" },
  { id: "Crimson", hex: "#E11D48" },
  { id: "Magenta", hex: "#D946EF" },
  { id: "Lime", hex: "#84CC16" },
  { id: "Mint", hex: "#14B8A6" },
];

export async function setTheme(patch: Partial<ThemeState>): Promise<void> {
  const next = await imb.theme.set(patch);
  applyThemeAccent(next.color);
  applyThemeModeAttr(next.mode);
  appStore.theme = next;
}

export function updateThemeState(state: ThemeState): void {
  applyThemeAccent(state.color);
  applyThemeModeAttr(state.mode);
  appStore.theme = state;
}

/**
 * Ink (text/icon) colour painted on top of an accent fill must clear this
 * ratio; below it the label stops being readable on bright presets. macOS
 * keeps controls at 3:1 rather than 4.5:1, and so do we (native look first).
 */
const ACCENT_INK_MIN_CONTRAST = 3;
const ACCENT_INK_LIGHT = "#ffffff";
const ACCENT_INK_DARK = "#1a1a1a";

/**
 * Accent presets whose white ink is part of the brand identity even though it
 * sits below `ACCENT_INK_MIN_CONTRAST` (WeChat green). Removing an entry is all
 * it takes to hand that preset back to the contrast rule.
 */
const BRAND_WHITE_INK = new Set<string>(["#07C160"]);

/**
 * Inject an accent preset as CSS variables (prototype-parity derivation).
 *
 * Only the *inputs* are injected here: the accent, its hover/active steps and
 * the ink painted on top of it. Everything derived from them (soft tint, focus
 * ring) is declared once in `styles/tokens.css` against `--imb-accent`, so a
 * preset has exactly one source of truth.
 */
function applyThemeAccent(hex: string): void {
  const color = typeof hex === "string" ? hex.toUpperCase() : "";
  if (!/^#[0-9A-F]{6}$/.test(color)) return; // defensive: never paint an invalid colour
  const { h, s, l } = hexToHsl(color);
  const root = document.documentElement;
  // Write the *primitives*: `--imb-accent` and everything derived from it (soft
  // tint, ring, inactive-window desaturation) is declared once in tokens.css
  // against `--imb-p-accent`, so a preset has exactly one source of truth and
  // stylesheet-level states can recolour it.
  root.style.setProperty("--imb-p-accent", color);
  root.style.setProperty("--imb-p-accent-on", accentInk(color));
  root.style.setProperty(
    "--imb-p-accent-hover",
    `hsl(${h}, ${s}%, ${Math.min(l + 8, 95)}%)`,
  );
  root.style.setProperty(
    "--imb-p-accent-active",
    `hsl(${h}, ${s}%, ${Math.max(l - 10, 8)}%)`,
  );
  // Status colours are not theme colours: `--imb-success` stays the system
  // green that tokens.css declares, whatever accent is selected.
  root.style.removeProperty("--imb-success");
  // Superseded inline derivations from older builds; drop them so the tokens'
  // `color-mix()` versions apply.
  root.style.removeProperty("--imb-accent");
  root.style.removeProperty("--imb-accent-on");
  root.style.removeProperty("--imb-accent-hover");
  root.style.removeProperty("--imb-accent-active");
  root.style.removeProperty("--imb-accent-soft");
  root.style.removeProperty("--imb-focus-ring");
}

/** White unless white would be unreadable on that fill (brand presets pinned). */
function accentInk(hex: string): string {
  if (BRAND_WHITE_INK.has(hex)) return ACCENT_INK_LIGHT;
  return contrastRatio(hex, ACCENT_INK_LIGHT) >= ACCENT_INK_MIN_CONTRAST
    ? ACCENT_INK_LIGHT
    : ACCENT_INK_DARK;
}

/** WCAG relative luminance of an `#RRGGBB` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours (1–21). */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** Set/clear the `data-theme-mode` attribute (system = clear). */
function applyThemeModeAttr(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme-mode");
  } else {
    root.setAttribute("data-theme-mode", mode);
  }
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}
