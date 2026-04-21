/**
 * Vertical preset registry.
 *
 * Presets are activated via the `VERTICAL_PRESET` env var. They seed pipeline
 * stages, AI prompts, and webhook-source defaults at install-time.
 *
 * To add a new vertical: create `lib/presets/<vertical>.ts` exporting an object
 * of the same shape as `aestheticClinicPreset`, then register it here.
 */

import { aestheticClinicPreset } from './aesthetic_clinic';

export { aestheticClinicPreset };
export type VerticalPresetId = 'aesthetic_clinic';

export const presetsById = {
  aesthetic_clinic: aestheticClinicPreset,
} as const;

/**
 * Resolve the active preset from the env var. Returns `null` if unset or unknown.
 * Callers must handle null (no vertical customization).
 */
export function getActivePreset() {
  const id = process.env.VERTICAL_PRESET;
  if (!id) return null;
  if (id in presetsById) {
    return presetsById[id as VerticalPresetId];
  }
  console.warn(`[presets] Unknown VERTICAL_PRESET="${id}" — no preset loaded.`);
  return null;
}
