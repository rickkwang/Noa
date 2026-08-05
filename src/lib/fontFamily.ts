/**
 * Resolves the stored `appearance.fontFamily` setting into a CSS font stack.
 *
 * Noa no longer bundles typefaces. The setting holds either SYSTEM_DEFAULT_FONT
 * or the family name of a font already installed on the device (enumerated via
 * `queryLocalFonts()` in the settings picker).
 *
 * The system default is deliberately expressed as CSS generic keywords rather
 * than a family name: browsers refuse to resolve the platform UI face by its
 * real name (`.AppleSystemUIFont` on macOS) as an anti-fingerprinting measure,
 * so referencing it by the name `queryLocalFonts()` reports silently renders a
 * different face. `-apple-system` / `system-ui` are the supported spellings.
 *
 * Keep SYSTEM_FONT_STACK in sync with the `--font-redaction` fallback in
 * `src/index.css`, which paints before this module's value is applied.
 */

export const SYSTEM_DEFAULT_FONT = 'system-default';

export const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/**
 * Family names reach CSS through a `<style>` element in ThemeInjector, so a
 * name carrying quotes, braces or semicolons could terminate the declaration
 * and inject rules. Real family names — including CJK ones — are letters,
 * digits, spaces and light punctuation, so anything else is rejected outright
 * rather than escaped.
 */
const SAFE_FAMILY = /^[\p{L}\p{N} ._-]{1,120}$/u;

export function isSafeFontFamilyName(value: string): boolean {
  return SAFE_FAMILY.test(value);
}

/**
 * Builds the CSS `font-family` value for a stored setting. Named fonts keep the
 * system stack as a suffix so uninstalling a font degrades to the platform UI
 * face instead of the browser's default serif.
 */
export function resolveFontFamily(fontFamily: string): string {
  if (!fontFamily || fontFamily === SYSTEM_DEFAULT_FONT) return SYSTEM_FONT_STACK;
  if (!isSafeFontFamilyName(fontFamily)) return SYSTEM_FONT_STACK;
  return `"${fontFamily}", ${SYSTEM_FONT_STACK}`;
}
