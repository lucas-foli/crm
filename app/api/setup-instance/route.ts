import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getActivePreset } from '@/lib/presets';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const SetupSchema = z
  .object({
    companyName: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(6),
  })
  .strict();

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * Idempotently seed a default board + preset pipeline stages for a freshly
 * created organization, when `VERTICAL_PRESET` selects a known vertical.
 *
 * Safe to call repeatedly — returns early if a default board with the preset
 * key already exists for the org.
 *
 * Non-fatal: seed errors are logged but do NOT fail setup.
 */
async function seedVerticalPreset(admin: AdminClient, organizationId: string): Promise<void> {
  const preset = getActivePreset();
  if (!preset) return;

  try {
    // Idempotency: if a board with this key already exists for the org, skip.
    const { data: existing } = await admin
      .from('boards')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('key', preset.defaultBoard.key)
      .maybeSingle();

    if (existing) {
      return;
    }

    const { data: board, error: boardErr } = await admin
      .from('boards')
      .insert({
        organization_id: organizationId,
        key: preset.defaultBoard.key,
        name: preset.defaultBoard.name,
        type: preset.defaultBoard.type,
        is_default: preset.defaultBoard.isDefault,
        template: preset.id,
      })
      .select('id')
      .single();

    if (boardErr || !board) {
      console.warn('[preset] Failed to create default board:', boardErr);
      return;
    }

    const stageRows = preset.pipelineStages.map((s) => ({
      board_id: board.id,
      organization_id: organizationId,
      name: s.name,
      label: s.name,
      color: s.color,
      order: s.order,
      is_default: s.isDefault === true,
    }));

    const { error: stagesErr } = await admin.from('board_stages').insert(stageRows);
    if (stagesErr) {
      console.warn('[preset] Failed to seed stages:', stagesErr);
    }
  } catch (err) {
    console.warn('[preset] Seed failed (non-fatal):', err);
  }
}

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  // Setup inicial tem efeito colateral; bloqueia cross-site.
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = SetupSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const { companyName, email, password } = parsed.data;

  const admin = createStaticAdminClient();

  // Só permite setup se ainda não inicializado.
  const { data: isInitialized, error: initError } = await admin.rpc('is_instance_initialized');
  if (initError) return json({ error: initError.message }, 500);
  if (isInitialized) return json({ error: 'Instance already initialized' }, 403);

  const { data: organization, error: orgError } = await admin
    .from('organizations')
    .insert({ name: companyName })
    // Performance: only the id/name are used downstream; keep payload minimal.
    .select('id, name')
    .single();

  if (orgError) return json({ error: orgError.message }, 500);

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'admin',
      organization_id: organization.id,
    },
  });

  if (userError) {
    await admin.from('organizations').delete().eq('id', organization.id);
    return json({ error: userError.message }, 400);
  }

  const userId = userData.user.id;
  const displayName = email.split('@')[0];

  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      name: displayName,
      first_name: displayName,
      organization_id: organization.id,
      role: 'admin',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    await admin.from('organizations').delete().eq('id', organization.id);
    return json({ error: profileError.message }, 400);
  }

  // Seed vertical preset (idempotent, non-fatal). Runs after org + admin exist.
  await seedVerticalPreset(admin, organization.id);

  return json({ ok: true, organization, user: { id: userId, email } }, 201);
}
