/**
 * Convert any CSS color (HEX #rrggbb / #rgb) to the `H S% L%` triplet expected by
 * our Tailwind tokens. Keeps the same output shape as simplifi's utility so
 * per-client branding files are portable between the two repos.
 *
 * Inputs that aren't HEX are returned unchanged (assumed already HSL or CSS var).
 */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const num = parseInt(h, 16);
  return {
    r: ((num >> 16) & 0xff) / 255,
    g: ((num >> 8) & 0xff) / 255,
    b: (num & 0xff) / 255,
  };
}

/**
 * Convert HEX → `"H S% L%"` string (space-separated, NO leading `hsl(`) so
 * it slots into `hsl(var(--color-primary))` Tailwind tokens.
 *
 * Non-HEX inputs are returned as-is (caller may already have an HSL triplet).
 */
export function hexToHslTriplet(input: string): string {
  if (!input) return input;
  const rgb = parseHex(input);
  if (!rgb) return input;

  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  const hue = Math.round(h * 360);
  const sat = Math.round(clamp01(s) * 100);
  const lum = Math.round(clamp01(l) * 100);
  return `${hue} ${sat}% ${lum}%`;
}
