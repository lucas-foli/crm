/**
 * @fileoverview US-VOICE-002 — Voice UI Components Tests
 *
 * Testa VoiceCallButton.tsx e VoiceCallTranscript.tsx.
 *
 * @module test/stories/US-VOICE-002-voice-ui
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// =============================================================================
// Mocks
// =============================================================================

const mockMutateAsync = vi.fn();
const mockReset = vi.fn();

let mockVoiceConfig: {
  voice_enabled: boolean;
  elevenlabs_agent_id: string | null;
} | null = {
  voice_enabled: true,
  elevenlabs_agent_id: 'agent-123',
};

let mockStartCallState = {
  data: null as null | {
    signedUrl: string;
    dynamicVariables: Record<string, string>;
    callId: string;
  },
  isPending: false,
};

vi.mock('@/lib/query/hooks', () => ({
  useVoiceConfigQuery: () => ({
    data: mockVoiceConfig,
    isLoading: false,
    error: null,
  }),
  useStartVoiceCallMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockStartCallState.isPending,
    data: mockStartCallState.data,
    reset: mockReset,
  }),
}));

// Mock VoiceCallWidget since we only test VoiceCallButton behavior
vi.mock('@/features/voice/components/VoiceCallWidget', () => ({
  VoiceCallWidget: ({
    onCallEnd,
  }: {
    signedUrl: string;
    dynamicVariables: Record<string, string>;
    callId: string;
    onCallEnd: () => void;
    onError: (err: string) => void;
  }) => (
    <div data-testid="voice-call-widget">
      <button onClick={onCallEnd}>End Call</button>
    </div>
  ),
}));

// =============================================================================
// Helpers
// =============================================================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// =============================================================================
// VoiceCallButton Tests
// =============================================================================

describe('US-VOICE-002: VoiceCallButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceConfig = {
      voice_enabled: true,
      elevenlabs_agent_id: 'agent-123',
    };
    mockStartCallState = { data: null, isPending: false };
    mockMutateAsync.mockResolvedValue({
      signedUrl: 'wss://test.elevenlabs.io/abc',
      dynamicVariables: { contact_name: 'Lead' },
      callId: 'call-1',
    });
  });

  // Lazy import to pick up fresh mocks
  async function renderButton(dealId = 'deal-1') {
    const { VoiceCallButton } = await import(
      '@/features/voice/components/VoiceCallButton'
    );
    return render(
      <TestWrapper>
        <VoiceCallButton dealId={dealId} />
      </TestWrapper>
    );
  }

  it('nao renderiza quando voice_enabled=false', async () => {
    mockVoiceConfig = { voice_enabled: false, elevenlabs_agent_id: 'agent-1' };

    const { container } = await renderButton();
    expect(container.innerHTML).toBe('');
  });

  it('nao renderiza quando elevenlabs_agent_id e null', async () => {
    mockVoiceConfig = { voice_enabled: true, elevenlabs_agent_id: null };

    const { container } = await renderButton();
    expect(container.innerHTML).toBe('');
  });

  it('renderiza botao quando voice habilitado', async () => {
    await renderButton();

    const btn = screen.getByRole('button', { name: /IA Voice/i });
    expect(btn).toBeTruthy();
    expect(screen.getByText('IA Voice')).toBeTruthy();
  });

  it('clique inicia chamada e mostra VoiceCallWidget', async () => {
    // After mutateAsync resolves, update data in mock
    mockMutateAsync.mockImplementation(async () => {
      const result = {
        signedUrl: 'wss://test.elevenlabs.io/abc',
        dynamicVariables: { contact_name: 'Lead' },
        callId: 'call-1',
      };
      // Simulate the state update that TanStack Query would do
      mockStartCallState.data = result;
      return result;
    });

    const user = userEvent.setup();
    const { VoiceCallButton } = await import(
      '@/features/voice/components/VoiceCallButton'
    );

    const { rerender } = render(
      <TestWrapper>
        <VoiceCallButton dealId="deal-1" />
      </TestWrapper>
    );

    const btn = screen.getByRole('button', { name: /IA Voice/i });
    await user.click(btn);

    expect(mockMutateAsync).toHaveBeenCalledWith({ dealId: 'deal-1' });

    // Re-render with updated state (simulating React state update)
    rerender(
      <TestWrapper>
        <VoiceCallButton dealId="deal-1" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('voice-call-widget')).toBeTruthy();
    });
  });

  it('mostra loading durante startVoiceCall mutation', async () => {
    mockStartCallState.isPending = true;

    await renderButton();

    const btn = screen.getByRole('button', { name: /IA Voice/i });
    expect(btn).toHaveProperty('disabled', true);
  });
});

// =============================================================================
// VoiceCallTranscript Tests
// =============================================================================

describe('US-VOICE-002: VoiceCallTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderTranscript(
    props: Partial<{
      transcript: Array<{
        role: 'agent' | 'user';
        message: string;
        time_in_call_secs: number;
      }>;
      analysis: {
        call_successful: string;
        transcript_summary: string;
      } | null;
      durationSeconds: number | null;
      mode: 'ai_agent' | 'human_call';
    }> = {}
  ) {
    const { VoiceCallTranscript } = await import(
      '@/features/voice/components/VoiceCallTranscript'
    );

    const defaultTranscript = [
      { role: 'agent' as const, message: 'Olá, tudo bem?', time_in_call_secs: 0 },
      {
        role: 'user' as const,
        message: 'Sim, quero saber sobre o produto',
        time_in_call_secs: 3,
      },
      {
        role: 'agent' as const,
        message: 'Claro! Posso te ajudar com isso.',
        time_in_call_secs: 6,
      },
    ];

    return render(
      <VoiceCallTranscript
        transcript={props.transcript ?? defaultTranscript}
        analysis={props.analysis ?? null}
        durationSeconds={props.durationSeconds ?? 150}
        mode={props.mode ?? 'ai_agent'}
      />
    );
  }

  it('renderiza turnos agent/user corretamente', async () => {
    await renderTranscript();

    expect(screen.getByText('Olá, tudo bem?')).toBeTruthy();
    expect(screen.getByText('Sim, quero saber sobre o produto')).toBeTruthy();
    expect(screen.getByText('Claro! Posso te ajudar com isso.')).toBeTruthy();

    // Check role labels
    const iaLabels = screen.getAllByText('IA');
    expect(iaLabels.length).toBe(2); // 2 agent turns in ai_agent mode

    expect(screen.getByText('Lead')).toBeTruthy();
  });

  it('mostra summary da analise quando disponivel', async () => {
    await renderTranscript({
      analysis: {
        call_successful: 'true',
        transcript_summary: 'Lead mostrou forte interesse no produto premium.',
      },
    });

    expect(
      screen.getByText('Lead mostrou forte interesse no produto premium.')
    ).toBeTruthy();
  });

  it('mostra duracao formatada', async () => {
    await renderTranscript({ durationSeconds: 150 });

    // 150 seconds = 2:30
    expect(screen.getByText('2:30')).toBeTruthy();
  });

  it('nao mostra analysis quando nao disponivel', async () => {
    await renderTranscript({ analysis: null });

    // Should still render transcript but no summary section
    expect(screen.getByText('Olá, tudo bem?')).toBeTruthy();
    expect(
      screen.queryByText('Lead mostrou forte interesse')
    ).toBeNull();
  });

  it('diferencia modo ai_agent vs human_call visualmente', async () => {
    // ai_agent mode: agent role shows "IA"
    const { unmount } = await renderTranscript({ mode: 'ai_agent' });
    expect(screen.getByText('Chamada IA')).toBeTruthy();
    const iaLabels = screen.getAllByText('IA');
    expect(iaLabels.length).toBeGreaterThan(0);
    unmount();

    // human_call mode: agent role shows "Vendedor"
    await renderTranscript({ mode: 'human_call' });
    expect(screen.getByText('Chamada')).toBeTruthy();
    const vendedorLabels = screen.getAllByText('Vendedor');
    expect(vendedorLabels.length).toBeGreaterThan(0);
  });
});
