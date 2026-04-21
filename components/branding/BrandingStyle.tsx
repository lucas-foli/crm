import { branding } from '@/config/branding';
import { hexToHslTriplet } from '@/lib/branding/hexToHsl';

/**
 * Server component that injects the per-client branding as CSS custom properties
 * at `:root`. Rendered from `app/layout.tsx` so every route inherits the palette.
 *
 * Minimum viable implementation: writes `--brand-*` tokens. Individual
 * components may use them as `hsl(var(--brand-primary))` or as raw values via
 * `--brand-primary-hex`. Follow-up work (M2): migrate hardcoded color usages
 * in Nav/Sidebar/primary buttons to these tokens.
 */
export function BrandingStyle() {
  const c = branding.colors;
  const lines: string[] = [];

  lines.push(`--brand-primary: ${hexToHslTriplet(c.primary)};`);
  lines.push(`--brand-primary-hex: ${c.primary};`);
  lines.push(`--brand-primary-foreground: ${hexToHslTriplet(c.primaryForeground)};`);
  lines.push(`--brand-secondary: ${hexToHslTriplet(c.secondary)};`);
  lines.push(`--brand-secondary-foreground: ${hexToHslTriplet(c.secondaryForeground)};`);
  lines.push(`--brand-accent: ${hexToHslTriplet(c.accent)};`);
  lines.push(`--brand-accent-foreground: ${hexToHslTriplet(c.accentForeground)};`);
  lines.push(`--brand-chart-1: ${hexToHslTriplet(c.chart1)};`);
  lines.push(`--brand-chart-2: ${hexToHslTriplet(c.chart2)};`);
  lines.push(`--brand-chart-3: ${hexToHslTriplet(c.chart3)};`);
  lines.push(`--brand-chart-4: ${hexToHslTriplet(c.chart4)};`);
  lines.push(`--brand-chart-5: ${hexToHslTriplet(c.chart5)};`);

  if (branding.cssVars) {
    for (const [k, v] of Object.entries(branding.cssVars)) {
      lines.push(`--${k}: ${v};`);
    }
  }

  const css = `:root{${lines.join('')}}`;

  // Static, safe (no user input) — inline <style> is the right mechanism here.
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
