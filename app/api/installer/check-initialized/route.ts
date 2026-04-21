import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
}

/**
 * Verifica se o wizard de instalação pode ser servido.
 *
 * Default-deny:
 *  - Se `INSTALLER_ENABLED !== 'true'`, o wizard NÃO é servido (installer off).
 *  - Se `INSTALLER_TOKEN` estiver definido e o header/query token não bater, o wizard NÃO é servido.
 *  - Se a instância já foi inicializada (RPC `is_instance_initialized` === true), o wizard NÃO é servido.
 *
 * Em qualquer cenário de "não servir", retornamos `{ initialized: true, allowed: false }`
 * para que o client trate como 404/redirect — **sem vazar** o motivo exato.
 *
 * Bypass apenas em `NODE_ENV === 'development'`.
 *
 * @returns {Promise<Response>} Retorna { initialized: boolean, allowed: boolean }
 */
export async function GET(req: Request) {
  // Bypass em desenvolvimento local: sempre permite acesso ao wizard
  if (process.env.NODE_ENV === 'development') {
    return json({ initialized: false, allowed: true });
  }

  // Default-deny: INSTALLER_ENABLED precisa ser exatamente 'true' para servir o wizard.
  if (process.env.INSTALLER_ENABLED !== 'true') {
    return json({ initialized: true, allowed: false });
  }

  // Se INSTALLER_TOKEN estiver definido, exigimos que o caller apresente-o.
  // Aceitamos via header `x-installer-token` ou query `?token=`.
  const expectedToken = process.env.INSTALLER_TOKEN;
  if (expectedToken) {
    const headerToken = req.headers.get('x-installer-token') || '';
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token') || '';
    const providedToken = headerToken || queryToken;
    if (providedToken !== expectedToken) {
      return json({ initialized: true, allowed: false });
    }
  }

  // Verifica marcador de instalação concluída via RPC (settings table).
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('is_instance_initialized');

    if (error) {
      // Em caso de erro no RPC (ex.: banco não migrado ainda), consideramos "fresh"
      // para permitir o primeiro bootstrap. Esse é o único cenário permissivo.
      console.warn('[check-initialized] Error checking initialization:', error);
      return json({ initialized: false, allowed: true });
    }

    if (data === true) {
      // Instância já inicializada: default-deny — wizard não deve servir novamente.
      return json({ initialized: true, allowed: false });
    }

    return json({ initialized: false, allowed: true });
  } catch (err) {
    console.warn('[check-initialized] Exception:', err);
    return json({ initialized: false, allowed: true });
  }
}
