/**
 * Per-client branding config for NossoCRM.
 *
 * **Shape mirrors `simplifi-agent-pj/src/config/branding.ts`** so the same
 * rebrand workflow works across both products. To white-label for a new
 * client: copy `branding.example.ts` to `branding.ts`, edit, commit.
 *
 * Colors may be HEX or any CSS color. They are converted to HSL tokens and
 * injected into the DOM at runtime by `components/branding/BrandingProvider`.
 */

export interface BrandingLogo {
  /** Horizontal wordmark, light background. */
  horizontal: string;
  /** Horizontal wordmark, dark background (inverted). */
  horizontalInverted: string;
  /** Square mark / icon. */
  mark: string;
}

export interface BrandingColors {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  /** Chart series palette. */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export interface BrandingImages {
  hero?: string;
  login?: string;
  dashboard?: string;
}

export interface BrandingDashboardPalette {
  primary?: string;
  secondary?: string;
  background?: string;
  foreground?: string;
}

export interface BrandingConfig {
  /** Name shown in page titles, headers, meta tags. */
  brandName: string;
  /** Asset paths (relative to /public). */
  logo: BrandingLogo;
  /** Brand palette. */
  colors: BrandingColors;
  /** Favicon path (relative to /public). */
  favicon: string;
  /** Optional hero/splash images. */
  images?: BrandingImages;
  /** Optional dashboard-specific palette override. */
  dashboard?: BrandingDashboardPalette;
  /** Escape hatch: arbitrary CSS custom properties (without the `--` prefix). */
  cssVars?: Record<string, string>;
  /** Optional tenant slug, used for subdomain resolution. */
  tenantSlug?: string;
}

/**
 * Default branding — NossoCRM. Mirrors the current hardcoded palette so the
 * visual output is unchanged until a per-client override is committed.
 */
export const branding: BrandingConfig = {
  brandName: 'NossoCRM',
  logo: {
    horizontal: '/branding/logo-horizontal.svg',
    horizontalInverted: '/branding/logo-horizontal-inverted.svg',
    mark: '/branding/logo-mark.svg',
  },
  colors: {
    primary: '#0ea5e9',          // sky-500
    primaryForeground: '#ffffff',
    secondary: '#1e293b',         // slate-800
    secondaryForeground: '#f8fafc',
    accent: '#14b8a6',            // teal-500
    accentForeground: '#ffffff',
    chart1: '#0ea5e9',
    chart2: '#14b8a6',
    chart3: '#f59e0b',
    chart4: '#ef4444',
    chart5: '#a78bfa',
  },
  favicon: '/favicon.ico',
  images: {},
  dashboard: {},
  cssVars: {},
};

export default branding;
