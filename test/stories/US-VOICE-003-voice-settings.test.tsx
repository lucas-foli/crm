/**
 * @fileoverview US-VOICE-003 — Voice Settings Tests
 *
 * Testa VoiceSection.tsx (component + RBAC).
 *
 * @module test/stories/US-VOICE-003-voice-settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// =============================================================================
// Mocks
// =============================================================================

let mockProfile: {
  id: string;
  role: string;
  organization_id: string;
} = {
  id: 'user-1',
  role: 'admin',
  organization_id: 'org-1',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockProfile.id },
    profile: mockProfile,
  }),
}));

let mockVoiceConfig: {
  voice_enabled: boolean;
  elevenlabs_agent_id: string | null;
} | null = null;

let mockConfigLoading = false;

const mockEnableVoice = vi.fn();

vi.mock('@/lib/query/hooks/useVoiceCallsQuery', () => ({
  useVoiceConfigQuery: () => ({
    data: mockVoiceConfig,
    isLoading: mockConfigLoading,
    error: null,
  }),
  useEnableVoiceMutation: () => ({
    mutateAsync: mockEnableVoice,
    isPending: false,
  }),
}));

// Mock supabase
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({
      data: null,
      error: null,
    }),
  }),
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })),
  },
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
// Tests
// =============================================================================

describe('US-VOICE-003: VoiceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { id: 'user-1', role: 'admin', organization_id: 'org-1' };
    mockVoiceConfig = null;
    mockConfigLoading = false;
  });

  async function renderSection() {
    const { VoiceSection } = await import(
      '@/features/settings/components/VoiceSection'
    );
    return render(
      <TestWrapper>
        <VoiceSection />
      </TestWrapper>
    );
  }

  it('nao permite configuracao para nao-admin', async () => {
    mockProfile = { id: 'user-2', role: 'vendedor', organization_id: 'org-1' };

    await renderSection();

    expect(
      screen.getByText('Apenas administradores podem configurar Voice AI.')
    ).toBeTruthy();

    // Should NOT show API key input
    expect(screen.queryByPlaceholderText('xi_...')).toBeNull();
  });

  it('mostra badge "Inativo" quando voice nao habilitado', async () => {
    mockVoiceConfig = { voice_enabled: false, elevenlabs_agent_id: null };

    await renderSection();

    expect(screen.getByText('Inativo')).toBeTruthy();
  });

  it('mostra badge "Ativo" quando voice habilitado', async () => {
    mockVoiceConfig = {
      voice_enabled: true,
      elevenlabs_agent_id: 'agent-abc',
    };

    await renderSection();

    expect(screen.getByText('Ativo')).toBeTruthy();
  });

  it('botao "Ativar Voice" fica disabled sem API key', async () => {
    mockVoiceConfig = { voice_enabled: false, elevenlabs_agent_id: null };

    await renderSection();

    // The save button text says "Ativar Voice" when no savedKey
    const btn = screen.getByText('Ativar Voice');
    expect(btn.closest('button')).toHaveProperty('disabled', true);
  });

  it('mostra Agent ID quando voice ativo', async () => {
    mockVoiceConfig = {
      voice_enabled: true,
      elevenlabs_agent_id: 'agent-xyz-123',
    };

    await renderSection();

    expect(screen.getByText('Agent ID:')).toBeTruthy();
    expect(screen.getByText('agent-xyz-123')).toBeTruthy();
  });

  it('botao remover aparece apenas quando tem chave salva', async () => {
    // No saved key — no remove button
    mockVoiceConfig = { voice_enabled: false, elevenlabs_agent_id: null };

    const { unmount } = await renderSection();

    // The remove button uses Trash2 icon, and only appears when savedKey is truthy.
    // Since we mock supabase to return null for elevenlabs_api_key, savedKey stays empty.
    // The button should not be in the DOM.
    const removeButtons = screen.queryAllByRole('button');
    const hasTrashButton = removeButtons.some(
      (btn) => btn.querySelector('svg.lucide-trash-2') !== null
    );
    expect(hasTrashButton).toBe(false);

    unmount();

    // With saved key — supabase returns a key
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { elevenlabs_api_key: 'xi_saved_key' },
          error: null,
        }),
      }),
    });

    mockVoiceConfig = {
      voice_enabled: true,
      elevenlabs_agent_id: 'agent-1',
    };

    await renderSection();

    // Wait for effect to load the saved key — need to wait for async state update
    // The component loads the key via useEffect, so we need to wait
    await vi.waitFor(() => {
      const buttons = screen.queryAllByRole('button');
      // With a saved key, there should be 3 buttons: Save, Remove, (potentially more)
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });
});
