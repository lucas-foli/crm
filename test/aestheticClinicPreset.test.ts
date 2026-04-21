/**
 * Smoke tests for the aesthetic-clinic vertical preset.
 *
 * Validates the shape of the preset + the vocab guard-rails that keep us
 * outside CFM/CFO regulated scope (no medical vocabulary in the AI prompt).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aestheticClinicPreset } from '@/lib/presets/aesthetic_clinic';
import { getActivePreset, presetsById } from '@/lib/presets';

const ORIGINAL_ENV = { ...process.env };

describe('aesthetic_clinic preset — shape', () => {
  it('exports the 7 mandated pipeline stages in order', () => {
    const names = aestheticClinicPreset.pipelineStages.map((s) => s.name);
    expect(names).toEqual([
      'Novo interesse',
      'Avaliação agendada',
      'Orçamento enviado',
      'Em negociação',
      'Procedimento agendado',
      'Pós-procedimento',
      'Retorno',
    ]);
  });

  it('sets Novo interesse as the default landing stage', () => {
    const defaultStage = aestheticClinicPreset.pipelineStages.find((s) => s.isDefault);
    expect(defaultStage?.name).toBe('Novo interesse');
  });

  it('exposes vertical-relevant contact fields', () => {
    const keys = aestheticClinicPreset.contactFields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'procedimento_interesse',
        'ticket_medio_desejado',
        'como_conheceu',
        'first_contact_channel',
      ])
    );
  });

  it('seeds an evolution_wa webhook source pointing at novo_interesse', () => {
    const evolution = aestheticClinicPreset.webhookSources.find(
      (w) => w.provider === 'evolution_wa'
    );
    expect(evolution).toBeDefined();
    expect(evolution?.defaultStageKey).toBe('novo_interesse');
  });
});

describe('aesthetic_clinic preset — AI prompt vocab guard-rails', () => {
  const prompt = aestheticClinicPreset.aiBriefingPrompt.toLowerCase();

  it('includes the beauty/wellness register allow-list', () => {
    const allow = ['cliente', 'procedimento', 'avaliação', 'orçamento', 'retorno'];
    for (const word of allow) {
      expect(prompt).toContain(word);
    }
  });

  it('explicitly tells the model to AVOID medical vocabulary (CFM/CFO scope)', () => {
    // The prompt must instruct avoidance of these terms so the model does not
    // emit them. We check the instruction is present.
    expect(prompt).toMatch(/nunca use vocabulário médico/);
    for (const blocked of ['paciente', 'prontuário', 'diagnóstico', 'receita médica']) {
      expect(prompt).toContain(blocked); // appears as part of the "evite X" list
    }
  });
});

describe('getActivePreset()', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VERTICAL_PRESET;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns null when VERTICAL_PRESET is unset', () => {
    expect(getActivePreset()).toBeNull();
  });

  it('returns the aesthetic_clinic preset when configured', () => {
    process.env.VERTICAL_PRESET = 'aesthetic_clinic';
    expect(getActivePreset()).toBe(presetsById.aesthetic_clinic);
  });

  it('returns null (and warns) for unknown preset ids', () => {
    process.env.VERTICAL_PRESET = 'not_a_real_vertical';
    expect(getActivePreset()).toBeNull();
  });
});
