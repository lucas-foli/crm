/**
 * Example per-client branding override. Copy to `branding.ts` and edit.
 *
 * Workflow:
 *  1. cp config/branding.example.ts config/branding.ts
 *  2. Edit values below
 *  3. Drop logo SVGs in /public/branding/ (same filenames)
 *  4. Commit, push, redeploy — no code changes needed beyond this file.
 */
import type { BrandingConfig } from './branding';

export const brandingExample: BrandingConfig = {
  brandName: 'Clínica Lumé',
  logo: {
    horizontal: '/branding/logo-horizontal.svg',
    horizontalInverted: '/branding/logo-horizontal-inverted.svg',
    mark: '/branding/logo-mark.svg',
  },
  colors: {
    // Warm rose-gold palette suited for aesthetic-clinic verticals.
    primary: '#c2746a',
    primaryForeground: '#ffffff',
    secondary: '#2b1d1a',
    secondaryForeground: '#f5ebe0',
    accent: '#d4a373',
    accentForeground: '#2b1d1a',
    chart1: '#c2746a',
    chart2: '#d4a373',
    chart3: '#e9c46a',
    chart4: '#a86b5f',
    chart5: '#786452',
  },
  favicon: '/favicon.ico',
  images: {
    login: '/branding/login-bg.jpg',
  },
  dashboard: {
    primary: '#c2746a',
  },
  cssVars: {},
  tenantSlug: 'clinica-lume',
};

export default brandingExample;
