/**
 * @fileoverview US-VOICE-001 — Voice Service + Webhook Tests
 *
 * Testa elevenlabs.service.ts (unit, mock fetch) e webhook-handler.ts (unit, mock crypto + supabase).
 *
 * @module test/stories/US-VOICE-001-voice-calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// =============================================================================
// Mocks
// =============================================================================

// Mock external modules that webhook-handler imports
vi.mock('@/lib/ai/agent/context-builder', () => ({
  buildLeadContext: vi.fn().mockResolvedValue({
    deal: { stage_id: 'stage-1' },
    contact: { name: 'Lead Test' },
    organization: { name: 'Org Test' },
  }),
}));

vi.mock('@/lib/ai/agent/stage-evaluator', () => ({
  evaluateStageAdvancement: vi.fn().mockResolvedValue({
    advanced: false,
    requiresConfirmation: false,
  }),
}));

vi.mock('@/lib/ai/extraction/extraction.service', () => ({
  extractAndUpdateBANT: vi.fn().mockResolvedValue({
    success: true,
    updated: [],
  }),
}));

vi.mock('@/lib/ai/agent/agent.service', () => ({
  getOrgAIConfig: vi.fn().mockResolvedValue({
    enabled: true,
    provider: 'google',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    hitlThreshold: 0.85,
  }),
}));

// =============================================================================
// Suite 1: elevenlabs.service.ts
// =============================================================================

describe('US-VOICE-001: ElevenLabs Service', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── createOrgAgent ───

  describe('createOrgAgent', () => {
    it('envia request correto para ElevenLabs', async () => {
      const { createOrgAgent } = await import('@/lib/voice/elevenlabs.service');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ agent_id: 'agent-123' }),
      });

      await createOrgAgent('xi_test_key', {
        name: 'Test Agent',
        systemPrompt: 'You are a sales assistant.',
        firstMessage: 'Hello!',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/convai/agents/create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'xi-api-key': 'xi_test_key',
          }),
        })
      );

      // Verify body structure
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        name: 'Test Agent',
        conversation_config: {
          agent: {
            prompt: { prompt: 'You are a sales assistant.' },
            first_message: 'Hello!',
            language: 'pt',
          },
          tts: {
            voice_id: '21m00Tcm4TlvDq8ikWAM',
            model_id: 'eleven_turbo_v2_5',
          },
        },
      });
    });

    it('retorna agentId', async () => {
      const { createOrgAgent } = await import('@/lib/voice/elevenlabs.service');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ agent_id: 'agent-xyz' }),
      });

      const result = await createOrgAgent('xi_key', {
        name: 'Agent',
        systemPrompt: 'prompt',
        firstMessage: 'hi',
      });

      expect(result).toBe('agent-xyz');
    });

    it('throws quando apiKey vazia', async () => {
      const { createOrgAgent } = await import('@/lib/voice/elevenlabs.service');

      await expect(
        createOrgAgent('', {
          name: 'Agent',
          systemPrompt: 'prompt',
          firstMessage: 'hi',
        })
      ).rejects.toThrow('[ElevenLabs] API key not provided');
    });
  });

  // ─── getSignedUrl ───

  describe('getSignedUrl', () => {
    it('retorna signedUrl e conversationId', async () => {
      const { getSignedUrl } = await import('@/lib/voice/elevenlabs.service');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            signed_url: 'wss://signed.elevenlabs.io/abc',
            conversation_id: 'conv-456',
          }),
      });

      const result = await getSignedUrl('xi_key', 'agent-123');

      expect(result).toEqual({
        signedUrl: 'wss://signed.elevenlabs.io/abc',
        conversationId: 'conv-456',
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/convai/conversation/get_signed_url',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  // ─── elevenLabsFetch error handling ───

  describe('elevenLabsFetch error handling', () => {
    it('throws em response nao-ok (401)', async () => {
      const { createOrgAgent } = await import('@/lib/voice/elevenlabs.service');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(
        createOrgAgent('bad_key', {
          name: 'Agent',
          systemPrompt: 'prompt',
          firstMessage: 'hi',
        })
      ).rejects.toThrow('[ElevenLabs] API error 401: Unauthorized');
    });

    it('throws em response nao-ok (500)', async () => {
      const { getSignedUrl } = await import('@/lib/voice/elevenlabs.service');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(getSignedUrl('xi_key', 'agent-1')).rejects.toThrow(
        '[ElevenLabs] API error 500'
      );
    });
  });

  // ─── buildDynamicVariables ───

  describe('buildDynamicVariables', () => {
    it('monta vars com contexto completo', async () => {
      const { buildDynamicVariables } = await import(
        '@/lib/voice/elevenlabs.service'
      );

      const result = buildDynamicVariables({
        contact: { name: 'Maria Silva', company: 'Acme Corp' },
        deal: { stage_name: 'Qualificação', value: 15000 },
        stage: { goal: 'Identificar budget e authority' },
        organization: { name: 'NossoCRM' },
        messages: [
          { role: 'lead', content: 'Tenho interesse' },
          { role: 'agent', content: 'Ótimo! Qual seu orçamento?' },
        ],
      });

      expect(result.contact_name).toBe('Maria Silva');
      expect(result.company_name).toBe('Acme Corp');
      expect(result.deal_stage).toBe('Qualificação');
      expect(result.stage_goal).toBe('Identificar budget e authority');
      expect(result.organization_name).toBe('NossoCRM');
      expect(result.deal_value).toBe('R$ 15.000');
      expect(result.recent_messages).toContain('Lead: Tenho interesse');
      expect(result.recent_messages).toContain('AI: Ótimo! Qual seu orçamento?');
    });

    it('usa defaults para valores null', async () => {
      const { buildDynamicVariables } = await import(
        '@/lib/voice/elevenlabs.service'
      );

      const result = buildDynamicVariables({
        contact: null,
        deal: null,
        stage: { goal: null },
        organization: { name: 'Org' },
        messages: [],
      });

      expect(result.contact_name).toBe('Lead');
      expect(result.company_name).toBe('Não informada');
      expect(result.deal_stage).toBe('Novo Lead');
      expect(result.stage_goal).toBe(
        'Qualificar interesse e coletar informações básicas'
      );
      expect(result.deal_value).toBe('Não definido');
      expect(result.recent_messages).toBe('Primeira interação');
    });
  });
});

// =============================================================================
// Suite 2: webhook-handler.ts
// =============================================================================

describe('US-VOICE-001: Webhook Handler', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-123';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ELEVENLABS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.ELEVENLABS_WEBHOOK_SECRET;
  });

  // ─── verifyElevenLabsWebhook ───

  describe('verifyElevenLabsWebhook', () => {
    it('aceita assinatura valida', async () => {
      const { verifyElevenLabsWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = '{"type":"post_call_transcription"}';
      const payload = `${timestamp}.${rawBody}`;
      const mac = createHmac('sha256', WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      const signatureHeader = `t=${timestamp},v0=${mac}`;

      const result = verifyElevenLabsWebhook(signatureHeader, rawBody);
      expect(result).toBe(true);
    });

    it('rejeita assinatura invalida', async () => {
      const { verifyElevenLabsWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = '{"type":"post_call_transcription"}';
      const signatureHeader = `t=${timestamp},v0=invalid_hash_here`;

      const result = verifyElevenLabsWebhook(signatureHeader, rawBody);
      expect(result).toBe(false);
    });

    it('rejeita timestamp velho (replay)', async () => {
      const { verifyElevenLabsWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      // 31 minutes ago
      const oldTimestamp = (
        Math.floor(Date.now() / 1000) - 31 * 60
      ).toString();
      const rawBody = '{"type":"post_call_transcription"}';
      const payload = `${oldTimestamp}.${rawBody}`;
      const mac = createHmac('sha256', WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      const signatureHeader = `t=${oldTimestamp},v0=${mac}`;

      const result = verifyElevenLabsWebhook(signatureHeader, rawBody);
      expect(result).toBe(false);
    });

    it('retorna false sem WEBHOOK_SECRET', async () => {
      delete process.env.ELEVENLABS_WEBHOOK_SECRET;

      // Re-import to pick up env change
      vi.resetModules();
      const { verifyElevenLabsWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const result = verifyElevenLabsWebhook('t=123,v0=abc', '{}');
      expect(result).toBe(false);
    });
  });

  // ─── processPostCallWebhook ───

  describe('processPostCallWebhook', () => {
    function createMockSupabase(voiceCall: Record<string, unknown> | null) {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const insertFn = vi.fn().mockResolvedValue({ error: null });

      return {
        from: vi.fn((table: string) => {
          if (table === 'voice_calls') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({
                      data: voiceCall,
                      error: voiceCall ? null : { message: 'Not found' },
                    }),
                }),
              }),
              update: updateFn,
            };
          }
          if (table === 'messaging_messages') {
            return { insert: insertFn };
          }
          if (table === 'messaging_conversations') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === 'stage_ai_config') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          if (table === 'ai_conversation_log') {
            return { insert: insertFn };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: insertFn,
            update: updateFn,
          };
        }),
        _updateFn: updateFn,
        _insertFn: insertFn,
      };
    }

    function createMockPayload(
      overrides: Partial<Record<string, unknown>> = {}
    ) {
      return {
        type: 'post_call_transcription' as const,
        event_timestamp: Date.now(),
        data: {
          agent_id: 'agent-1',
          conversation_id: 'el-conv-1',
          status: 'completed',
          transcript: [
            {
              role: 'agent' as const,
              message: 'Olá, tudo bem?',
              tool_calls: null,
              tool_results: null,
              feedback: null,
              time_in_call_secs: 0,
              conversation_turn_metrics: null,
            },
            {
              role: 'user' as const,
              message: 'Sim, quero saber sobre o produto',
              tool_calls: null,
              tool_results: null,
              feedback: null,
              time_in_call_secs: 3,
              conversation_turn_metrics: null,
            },
          ],
          metadata: {
            start_time_unix_secs: 1700000000,
            call_duration_secs: 120,
            cost: 0.05,
            termination_reason: 'user_ended',
            feedback: { overall_score: null, likes: 0, dislikes: 0 },
          },
          analysis: {
            evaluation_criteria_results: {},
            data_collection_results: {},
            call_successful: 'true',
            transcript_summary: 'Lead mostrou interesse no produto.',
          },
          ...overrides,
        },
      };
    }

    it('salva transcript e analysis', async () => {
      vi.resetModules();
      const { processPostCallWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const mockVoiceCall = {
        id: 'call-1',
        organization_id: 'org-1',
        deal_id: 'deal-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
      };

      const mockSb = createMockSupabase(mockVoiceCall);
      const payload = createMockPayload();

      const result = await processPostCallWebhook(
        mockSb as unknown as import('@supabase/supabase-js').SupabaseClient,
        payload
      );

      expect(result.success).toBe(true);
      expect(result.callId).toBe('call-1');

      // Verify voice_calls was queried
      expect(mockSb.from).toHaveBeenCalledWith('voice_calls');
    });

    it('cria messaging_message na conversation', async () => {
      vi.resetModules();
      const { processPostCallWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const mockVoiceCall = {
        id: 'call-1',
        organization_id: 'org-1',
        deal_id: 'deal-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
      };

      const mockSb = createMockSupabase(mockVoiceCall);
      const payload = createMockPayload();

      await processPostCallWebhook(
        mockSb as unknown as import('@supabase/supabase-js').SupabaseClient,
        payload
      );

      // messaging_messages insert should have been called
      const messagingCalls = (mockSb.from as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: string[]) => c[0] === 'messaging_messages'
      );
      expect(messagingCalls.length).toBeGreaterThan(0);
    });

    it('dispara AI pipeline (stage eval + BANT)', async () => {
      vi.resetModules();

      const { evaluateStageAdvancement } = await import(
        '@/lib/ai/agent/stage-evaluator'
      );
      const { extractAndUpdateBANT } = await import(
        '@/lib/ai/extraction/extraction.service'
      );
      const { processPostCallWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const mockVoiceCall = {
        id: 'call-1',
        organization_id: 'org-1',
        deal_id: 'deal-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
      };

      // Need a supabase mock that also returns stage config
      const mockSb = {
        from: vi.fn((table: string) => {
          if (table === 'voice_calls') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockVoiceCall,
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === 'messaging_messages') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          if (table === 'messaging_conversations') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === 'stage_ai_config') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      stage_id: 'stage-1',
                      criteria: [],
                      auto_advance: true,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'ai_conversation_log') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
      };

      const payload = createMockPayload();

      await processPostCallWebhook(
        mockSb as unknown as import('@supabase/supabase-js').SupabaseClient,
        payload
      );

      // evaluateStageAdvancement should have been called
      expect(evaluateStageAdvancement).toHaveBeenCalled();

      // extractAndUpdateBANT should have been called
      expect(extractAndUpdateBANT).toHaveBeenCalledWith(
        expect.objectContaining({
          dealId: 'deal-1',
          conversationId: 'conv-1',
          organizationId: 'org-1',
        })
      );
    });

    it('retorna error quando voice_call nao encontrado', async () => {
      vi.resetModules();
      const { processPostCallWebhook } = await import(
        '@/lib/voice/webhook-handler'
      );

      const mockSb = createMockSupabase(null);
      const payload = createMockPayload();

      const result = await processPostCallWebhook(
        mockSb as unknown as import('@supabase/supabase-js').SupabaseClient,
        payload
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Voice call not found');
    });
  });
});
