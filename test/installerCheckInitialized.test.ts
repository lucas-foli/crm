/**
 * Testes para `GET /api/installer/check-initialized`.
 *
 * Cobre o comportamento default-deny que protege o wizard de instalação contra
 * re-execução após o bootstrap inicial.
 *
 * Cenários:
 *  (a) INSTALLER_ENABLED não setado → bloqueia (allowed=false)
 *  (b) INSTALLER_ENABLED=true + instância já inicializada → bloqueia
 *  (c) INSTALLER_ENABLED=true + fresh → permite
 *  (d) INSTALLER_TOKEN definido sem header/query → bloqueia
 *  (e) INSTALLER_TOKEN definido com token correto → permite
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}));

import { GET } from '@/app/api/installer/check-initialized/route';

const ORIGINAL_ENV = { ...process.env };

function makeReq(url = 'https://example.com/api/installer/check-initialized', init?: RequestInit) {
  return new Request(url, init);
}

describe('GET /api/installer/check-initialized — default-deny', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    process.env = { ...ORIGINAL_ENV };
    // Force production-like behavior (bypass only in development).
    process.env.NODE_ENV = 'production';
    delete process.env.INSTALLER_ENABLED;
    delete process.env.INSTALLER_TOKEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('(a) blocks when INSTALLER_ENABLED is not set', async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual({ initialized: true, allowed: false });
    // Must not call supabase when env-gated.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('(b) blocks when instance already initialized', async () => {
    process.env.INSTALLER_ENABLED = 'true';
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual({ initialized: true, allowed: false });
  });

  it('(c) allows when INSTALLER_ENABLED=true and instance is fresh', async () => {
    process.env.INSTALLER_ENABLED = 'true';
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual({ initialized: false, allowed: true });
  });

  it('(d) blocks when INSTALLER_TOKEN set but caller provides nothing', async () => {
    process.env.INSTALLER_ENABLED = 'true';
    process.env.INSTALLER_TOKEN = 'secret-token-123';
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual({ initialized: true, allowed: false });
    // Must short-circuit before DB check.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('(e) allows when INSTALLER_TOKEN set and caller provides correct header', async () => {
    process.env.INSTALLER_ENABLED = 'true';
    process.env.INSTALLER_TOKEN = 'secret-token-123';
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const res = await GET(
      makeReq('https://example.com/api/installer/check-initialized', {
        headers: { 'x-installer-token': 'secret-token-123' },
      })
    );
    const body = await res.json();
    expect(body).toEqual({ initialized: false, allowed: true });
  });

  it('(f) blocks when INSTALLER_TOKEN set and caller provides wrong token', async () => {
    process.env.INSTALLER_ENABLED = 'true';
    process.env.INSTALLER_TOKEN = 'secret-token-123';
    const res = await GET(
      makeReq('https://example.com/api/installer/check-initialized?token=wrong', {})
    );
    const body = await res.json();
    expect(body).toEqual({ initialized: true, allowed: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('(g) allows when RPC errors — fail-open for fresh deploys without migrations', async () => {
    // This is the one permissive path: if `is_instance_initialized` RPC fails
    // (e.g. DB not yet migrated), we allow first-run bootstrap.
    process.env.INSTALLER_ENABLED = 'true';
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('function missing') });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual({ initialized: false, allowed: true });
  });
});
