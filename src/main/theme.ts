import { SettingKeys } from "@shared/constants/settings";
import type { ThemeMode, ThemeState } from "@shared/types";
import { nativeTheme } from "electron";
import { getSetting, setSetting } from "./db/settings";

/**
 * Theme ownership (confirmed decision): the DB `settings` table owns the
 * persisted values (`theme.mode`, `theme.color`); Electron's `nativeTheme`
 * applies the mode so Chromium's `prefers-color-scheme` follows it, and the
 * renderer injects the accent color as CSS variables (see renderer theme.ts).
 */

const VALID_MODES: ThemeMode[] = ["light", "dark", "system"];
// Private layer: keep in sync with the first entry of THEME_COLORS
// (src/renderer/theme.ts) so the default accent matches the picker.
const DEFAULT_COLOR = "#31895F";
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeMode(value: string | null | undefined): ThemeMode {
  return value && (VALID_MODES as string[]).includes(value)
    ? (value as ThemeMode)
    : "system";
}

/** Effective mode (reflects the OS when mode is "system"). */
export function getThemeMode(): ThemeMode {
  return nativeTheme.themeSource;
}

export function getThemeColor(): string {
  const stored = getSetting(SettingKeys.ThemeColor);
  return stored && COLOR_RE.test(stored) ? stored.toUpperCase() : DEFAULT_COLOR;
}

export function setThemeMode(mode: ThemeMode): void {
  const safe = sanitizeMode(mode);
  setSetting(SettingKeys.ThemeMode, safe);
  nativeTheme.themeSource = safe;
}

export function setThemeColor(color: string): void {
  if (typeof color !== "string" || !COLOR_RE.test(color)) {
    throw new Error("Invalid theme color.");
  }
  setSetting(SettingKeys.ThemeColor, color.toUpperCase());
}

export function getThemeState(): ThemeState {
  return { mode: getThemeMode(), color: getThemeColor() };
}

/** Apply the persisted mode at startup (called after DB init). */
export function initTheme(): void {
  nativeTheme.themeSource = sanitizeMode(getSetting(SettingKeys.ThemeMode));
}
