/**
 * Unit tests for hexToHslTriplet — the HEX → CSS HSL-token converter used to
 * inject per-client branding as Tailwind-compatible CSS custom properties.
 */
import { describe, expect, it } from 'vitest';
import { hexToHslTriplet } from '@/lib/branding/hexToHsl';

describe('hexToHslTriplet', () => {
  it('converts 6-char HEX to "H S% L%"', () => {
    // sky-500 #0ea5e9 ≈ 199° 89% 48%
    const out = hexToHslTriplet('#0ea5e9');
    expect(out).toMatch(/^\d+ \d+% \d+%$/);
    const [h, s, l] = out.split(' ');
    expect(Number(h)).toBeGreaterThanOrEqual(197);
    expect(Number(h)).toBeLessThanOrEqual(201);
    expect(s).toMatch(/^(8[0-9]|9[0-9])%$/);
    expect(l).toMatch(/^(4[0-9]|5[0-5])%$/);
  });

  it('expands 3-char HEX shorthand (#f0a → #ff00aa)', () => {
    const out = hexToHslTriplet('#f0a');
    expect(out).toMatch(/^\d+ \d+% \d+%$/);
  });

  it('tolerates missing leading # and mixed case', () => {
    expect(hexToHslTriplet('FFFFFF')).toBe('0 0% 100%');
    expect(hexToHslTriplet('#000000')).toBe('0 0% 0%');
  });

  it('returns non-HEX input unchanged (pass-through for pre-computed HSL)', () => {
    expect(hexToHslTriplet('210 50% 40%')).toBe('210 50% 40%');
    expect(hexToHslTriplet('var(--foo)')).toBe('var(--foo)');
  });

  it('handles empty string gracefully', () => {
    expect(hexToHslTriplet('')).toBe('');
  });
});
