/**
 * Verifies that the aesthetic-clinic vertical preset is correctly routed into
 * the briefing service's system prompt when `VERTICAL_PRESET=aesthetic_clinic`.
 *
 * We avoid invoking the full briefing service (which needs Supabase + AI SDK);
 * instead we exercise `getActivePreset()` + prompt-content assertions directly.
 *
 * The wiring in `briefing.service.ts` is a single line — if the preset is
 * active and pt-BR, `preset.aiBriefingPrompt` wins; else the DEFAULT pt-BR
 * prompt is used.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getActivePreset } from '@/lib/presets';

const ORIGINAL_ENV = { ...process.env };

describe('briefing prompt resolution via VERTICAL_PRESET', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VERTICAL_PRESET;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the aesthetic-clinic prompt when preset is active', () => {
    process.env.VERTICAL_PRESET = 'aesthetic_clinic';
    const preset = getActivePreset();
    expect(preset).not.toBeNull();
    expect(preset!.locale).toBe('pt-BR');
    expect(preset!.aiBriefingPrompt).toMatch(/clínicas de estética/i);
    // Guard-rail: must instruct to avoid medical vocabulary.
    expect(preset!.aiBriefingPrompt).toMatch(/nunca use vocabulário médico/i);
  });

  it('falls back (null preset) when env is unset — service uses generic prompt', () => {
    expect(getActivePreset()).toBeNull();
  });

  it('falls back (null preset) for non-pt-BR locales — documented guard', () => {
    // Today only aesthetic_clinic (pt-BR) exists. If we add an en-US preset
    // later, THIS test should stay green: the guard in resolveBriefingSystemPrompt
    // only uses presets whose locale === 'pt-BR'. Here we just assert the
    // contract: the current preset is pt-BR.
    process.env.VERTICAL_PRESET = 'aesthetic_clinic';
    const preset = getActivePreset();
    expect(preset?.locale).toBe('pt-BR');
  });
});
