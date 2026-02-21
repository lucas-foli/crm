/**
 * @fileoverview Voice Signed URL API
 *
 * GET /api/voice/signed-url?dealId=X
 * Gera signed URL para iniciar chamada com o agent ElevenLabs.
 * Retorna URL + dynamic variables com contexto do deal.
 *
 * @module app/api/voice/signed-url/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedUrl, buildDynamicVariables } from '@/lib/voice/elevenlabs.service';
import { buildLeadContext } from '@/lib/ai/agent/context-builder';

export async function GET(request: NextRequest) {
  const dealId = request.nextUrl.searchParams.get('dealId');

  if (!dealId) {
    return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's org
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Check voice is enabled, agent exists, and API key is configured
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('voice_enabled, elevenlabs_agent_id, elevenlabs_api_key')
      .eq('organization_id', profile.organization_id)
      .single();

    if (!orgSettings?.voice_enabled || !orgSettings.elevenlabs_agent_id) {
      return NextResponse.json(
        { error: 'Voice not enabled for this organization' },
        { status: 400 }
      );
    }

    if (!orgSettings.elevenlabs_api_key) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 400 }
      );
    }

    // Get deal + conversation for context
    const { data: deal } = await supabase
      .from('deals')
      .select('id, contact_id')
      .eq('id', dealId)
      .single();

    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Find conversation for this deal (if exists)
    const { data: conversations } = await supabase
      .from('messaging_conversations')
      .select('id')
      .contains('metadata', { deal_id: dealId })
      .limit(1);

    const conversationId = conversations?.[0]?.id;

    // Build context for dynamic variables
    let dynamicVariables;
    if (conversationId) {
      const context = await buildLeadContext({
        supabase,
        conversationId,
        organizationId: profile.organization_id,
      });

      if (context) {
        dynamicVariables = buildDynamicVariables(context);
      }
    }

    // Fallback: build minimal dynamic variables from deal data
    if (!dynamicVariables) {
      const { data: contact } = deal.contact_id
        ? await supabase
            .from('contacts')
            .select('name, company_name')
            .eq('id', deal.contact_id)
            .single()
        : { data: null };

      const { data: dealFull } = await supabase
        .from('deals')
        .select('title, value, stage:board_stages!inner(name)')
        .eq('id', dealId)
        .single();

      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', profile.organization_id)
        .single();

      const stageData = dealFull?.stage as unknown as { name: string } | null;

      dynamicVariables = buildDynamicVariables({
        contact: contact ? { name: contact.name, company: contact.company_name } : null,
        deal: {
          stage_name: stageData?.name || 'Novo Lead',
          value: dealFull?.value ?? null,
        },
        stage: { goal: 'Qualificar interesse e coletar informações básicas' },
        organization: { name: org?.name || 'Empresa' },
        messages: [],
      });
    }

    // Get signed URL from ElevenLabs
    const { signedUrl, conversationId: elConvId } = await getSignedUrl(
      orgSettings.elevenlabs_api_key,
      orgSettings.elevenlabs_agent_id
    );

    return NextResponse.json({
      signedUrl,
      dynamicVariables,
      elevenlabsConversationId: elConvId,
    });
  } catch (error) {
    console.error('[Voice SignedURL] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate signed URL' },
      { status: 500 }
    );
  }
}
