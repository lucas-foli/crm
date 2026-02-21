/**
 * @fileoverview ElevenLabs Conversational AI Service
 *
 * Gerencia agents ElevenLabs para voice calls no CRM.
 * Cada organização tem um agent próprio com dynamic variables por chamada.
 *
 * @module lib/voice/elevenlabs.service
 */

import type {
  CreateAgentParams,
  SignedUrlResponse,
  DynamicVariables,
} from './elevenlabs.types';

// =============================================================================
// Constants
// =============================================================================

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel - natural PT-BR compatible
const DEFAULT_TTS_MODEL = 'eleven_turbo_v2_5';
const DEFAULT_LANGUAGE = 'pt';

// =============================================================================
// API Helpers
// =============================================================================

async function elevenLabsFetch<T>(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!apiKey) {
    throw new Error('[ElevenLabs] API key not provided');
  }

  const url = `${ELEVENLABS_API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `[ElevenLabs] API error ${response.status}: ${error}`
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// Agent Management
// =============================================================================

/**
 * Cria um agent ElevenLabs para a organização.
 * O agent usa dynamic variables ({{var}}) que são preenchidas por chamada.
 */
export async function createOrgAgent(
  apiKey: string,
  params: CreateAgentParams
): Promise<string> {
  const result = await elevenLabsFetch<{ agent_id: string }>(
    apiKey,
    '/convai/agents/create',
    {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        conversation_config: {
          agent: {
            prompt: {
              prompt: params.systemPrompt,
            },
            first_message: params.firstMessage,
            language: params.language || DEFAULT_LANGUAGE,
          },
          tts: {
            voice_id: params.voiceId || DEFAULT_VOICE_ID,
            model_id: DEFAULT_TTS_MODEL,
          },
        },
      }),
    }
  );

  return result.agent_id;
}

/**
 * Atualiza o system prompt de um agent existente.
 */
export async function updateAgentPrompt(
  apiKey: string,
  agentId: string,
  systemPrompt: string,
  firstMessage?: string
): Promise<void> {
  await elevenLabsFetch(apiKey, `/convai/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: { prompt: systemPrompt },
          ...(firstMessage ? { first_message: firstMessage } : {}),
        },
      },
    }),
  });
}

// =============================================================================
// Conversation Management
// =============================================================================

/**
 * Gera um signed URL para iniciar uma conversa com o agent.
 * O URL é short-lived e seguro para enviar ao frontend.
 */
export async function getSignedUrl(
  apiKey: string,
  agentId: string
): Promise<SignedUrlResponse> {
  const result = await elevenLabsFetch<{
    signed_url: string;
    conversation_id?: string;
  }>(apiKey, '/convai/conversation/get_signed_url', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      includeConversationId: true,
    }),
  });

  return {
    signedUrl: result.signed_url,
    conversationId: result.conversation_id,
  };
}

/**
 * Busca detalhes de uma conversa completa (transcript, analysis).
 */
export async function getConversation(apiKey: string, conversationId: string): Promise<{
  id: string;
  agentId: string;
  callDurationSeconds: number;
  callSuccessful: boolean;
  transcript?: Array<{ role: string; message: string; time_in_call_secs: number }>;
  analysis?: { transcript_summary: string; call_successful: string };
}> {
  const result = await elevenLabsFetch<Record<string, unknown>>(
    apiKey,
    `/convai/conversations/${conversationId}`
  );

  return {
    id: result.id as string,
    agentId: result.agentId as string,
    callDurationSeconds: (result.callDurationSeconds ?? result.call_duration_seconds ?? 0) as number,
    callSuccessful: (result.callSuccessful ?? result.call_successful ?? false) as boolean,
    transcript: result.transcript as Array<{ role: string; message: string; time_in_call_secs: number }> | undefined,
    analysis: result.analysis as { transcript_summary: string; call_successful: string } | undefined,
  };
}

// =============================================================================
// Dynamic Variables Builder
// =============================================================================

/**
 * Constroi dynamic variables a partir do contexto do lead.
 * Essas variáveis são injetadas no prompt do agent via {{var}}.
 */
export function buildDynamicVariables(context: {
  contact: { name: string | null; company: string | null } | null;
  deal: { stage_name: string; value: number | null } | null;
  stage: { goal: string | null };
  organization: { name: string };
  messages: Array<{ role: string; content: string }>;
}): DynamicVariables {
  const recentMessages = context.messages
    .slice(-5)
    .map((m) => {
      const label = m.role === 'lead' ? 'Lead' : m.role === 'agent' ? 'AI' : 'Vendedor';
      return `${label}: ${m.content}`;
    })
    .join('\n');

  return {
    contact_name: context.contact?.name || 'Lead',
    company_name: context.contact?.company || 'Não informada',
    deal_stage: context.deal?.stage_name || 'Novo Lead',
    stage_goal: context.stage?.goal || 'Qualificar interesse e coletar informações básicas',
    organization_name: context.organization.name,
    deal_value: context.deal?.value
      ? `R$ ${context.deal.value.toLocaleString('pt-BR')}`
      : 'Não definido',
    recent_messages: recentMessages || 'Primeira interação',
  };
}

// =============================================================================
// Default System Prompt
// =============================================================================

/**
 * System prompt padrão para agents de venda.
 * Usa {{dynamic_variables}} que são preenchidas por chamada.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `Você é um assistente de vendas da {{organization_name}}.

CONTEXTO DO LEAD:
- Nome: {{contact_name}}
- Empresa: {{company_name}}
- Estágio: {{deal_stage}}
- Valor do deal: {{deal_value}}

HISTÓRICO RECENTE:
{{recent_messages}}

OBJETIVO:
{{stage_goal}}

INSTRUÇÕES:
- Fale em português brasileiro, de forma natural e amigável
- Seja conciso (conversa por voz, não chat)
- Colete informações de qualificação (BANT: Budget, Authority, Need, Timeline)
- Se o lead pedir algo fora do seu escopo, ofereça transferir para um humano
- Não invente informações sobre produtos/preços que não estejam no contexto
- Confirme dados importantes repetindo-os de volta ao lead
- Encerre a conversa de forma educada se o lead pedir`;

export const DEFAULT_FIRST_MESSAGE =
  'Olá {{contact_name}}, tudo bem? Aqui é da {{organization_name}}. Como posso te ajudar hoje?';
