/**
 * Vertical preset for **aesthetic clinics** (beleza/bem-estar, NÃO medicina).
 *
 * Activated via `VERTICAL_PRESET=aesthetic_clinic`. Seeds:
 *  - pipeline stages tailored to aesthetic-procedure funnels
 *  - PT-BR AI briefing prompt with beauty/wellness register (avoids medical vocabulary)
 *  - default webhook source config for Evolution WhatsApp inbound
 *  - vertical-relevant contact custom fields
 *
 * Vocab allow-list: cliente, procedimento, avaliação, orçamento, retorno,
 *                   harmonização, protocolo, sessão
 * Vocab block-list: paciente, prontuário, tratamento clínico, diagnóstico,
 *                   receita médica (keeps us outside CFM/CFO scope)
 */

export interface PipelineStageSpec {
  /** Machine-stable key (slug). */
  key: string;
  /** UI label in pt-BR. */
  name: string;
  /** 0-indexed order in the board. */
  order: number;
  /** Tailwind-compatible HEX. */
  color: string;
  /** Whether this is the default "new lead" landing stage. */
  isDefault?: boolean;
}

export interface ContactFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'enum' | 'date';
  options?: string[];
  required?: boolean;
}

export interface WebhookSourceSpec {
  key: string;
  label: string;
  provider: 'evolution_wa' | 'meta_wa' | 'zapi' | 'chatwoot';
  /** Stage key (must exist in pipelineStages) where inbound leads land. */
  defaultStageKey: string;
}

export const pipelineStages: PipelineStageSpec[] = [
  { key: 'novo_interesse',       name: 'Novo interesse',       order: 0, color: '#94a3b8', isDefault: true },
  { key: 'avaliacao_agendada',   name: 'Avaliação agendada',   order: 1, color: '#38bdf8' },
  { key: 'orcamento_enviado',    name: 'Orçamento enviado',    order: 2, color: '#a78bfa' },
  { key: 'em_negociacao',        name: 'Em negociação',        order: 3, color: '#f59e0b' },
  { key: 'procedimento_agendado',name: 'Procedimento agendado',order: 4, color: '#10b981' },
  { key: 'pos_procedimento',     name: 'Pós-procedimento',     order: 5, color: '#14b8a6' },
  { key: 'retorno',              name: 'Retorno',              order: 6, color: '#ec4899' },
];

export const contactFields: ContactFieldSpec[] = [
  {
    key: 'procedimento_interesse',
    label: 'Procedimento de interesse',
    type: 'text',
  },
  {
    key: 'ticket_medio_desejado',
    label: 'Ticket médio desejado (R$)',
    type: 'number',
  },
  {
    key: 'como_conheceu',
    label: 'Como conheceu',
    type: 'enum',
    options: ['Instagram', 'Indicação', 'Google', 'WhatsApp', 'Outro'],
  },
  {
    key: 'first_contact_channel',
    label: 'Canal do primeiro contato',
    type: 'enum',
    options: ['WhatsApp', 'Instagram', 'Telefone', 'Formulário', 'Presencial'],
  },
];

/**
 * PT-BR system prompt for AI briefings. Beauty/wellness register, **explicitly
 * avoids medical vocabulary** so we don't cross into CFM/CFO regulated scope.
 *
 * Consumed by `lib/ai/briefing/briefing.service.ts` when `VERTICAL_PRESET=aesthetic_clinic`
 * AND the locale falls back to pt-BR.
 */
export const aiBriefingPrompt = `Você é um assistente comercial brasileiro especializado em clínicas de estética e bem-estar. Prepara briefings pré-conversa para atendentes que vão retomar o contato com clientes interessadas em procedimentos estéticos.

IMPORTANTE — Registro e vocabulário:
- TODO o conteúdo DEVE estar em PORTUGUÊS BRASILEIRO.
- Use o registro de beleza/bem-estar: "cliente", "procedimento", "avaliação", "orçamento", "retorno", "sessão", "protocolo", "harmonização".
- NUNCA use vocabulário médico: evite "paciente", "prontuário", "tratamento clínico", "diagnóstico", "receita médica", "sintomas", "patologia".
- Foco comercial: agendamento de avaliação, envio de orçamento, recuperação de clientes que pararam de responder, upsell de sessões/protocolos.

Sua tarefa é analisar o histórico de comunicação com a cliente e gerar um briefing estruturado para que a atendente:
1. Entenda rapidamente o contexto (qual procedimento, qual objeção, qual estágio do funil)
2. Saiba exatamente onde parou a última conversa
3. Tenha perguntas específicas para avançar (agendar avaliação / confirmar orçamento / marcar retorno)

FRAMEWORK ADAPTADO (não use os rótulos BANT; use estes):
- Orçamento: qual faixa de investimento foi mencionada? Há parcelamento na mesa?
- Decisora: quem decide? É a cliente sozinha? Precisa falar com marido/mãe/amiga?
- Necessidade: qual incômodo/desejo motiva o procedimento? Foi validado?
- Prazo: há uma data-alvo (casamento, viagem, aniversário)? Existe urgência?

REGRAS:
- Seja concisa e acionável — a atendente lê em 30 segundos.
- Extraia informações CONCRETAS das conversas, não invente.
- Se algo não foi mencionado, escreva "Nenhuma informação disponível".
- Sugira 2-3 perguntas específicas baseadas no estágio atual.
- Alerte sobre riscos (cliente fria há X dias, orçamento acima da faixa, objeção não respondida).
- Sua confiança reflete a quantidade e qualidade de informações.
- NUNCA prometa resultado clínico ou faça promessa médica. Fale sempre em "avaliação presencial".`;

export const webhookSources: WebhookSourceSpec[] = [
  {
    key: 'evolution_wa_incoming',
    label: 'WhatsApp (Evolution API) — entrada',
    provider: 'evolution_wa',
    defaultStageKey: 'novo_interesse',
  },
];

/**
 * Full preset descriptor. Extend with more verticals by creating sibling files
 * and registering them in `lib/presets/index.ts`.
 */
export const aestheticClinicPreset = {
  id: 'aesthetic_clinic' as const,
  displayName: 'Clínica de Estética',
  locale: 'pt-BR' as const,
  pipelineStages,
  contactFields,
  aiBriefingPrompt,
  webhookSources,
  defaultBoard: {
    key: 'clinic-leads',
    name: 'Funil de Leads',
    type: 'SALES',
    isDefault: true,
  },
};

export type AestheticClinicPreset = typeof aestheticClinicPreset;
