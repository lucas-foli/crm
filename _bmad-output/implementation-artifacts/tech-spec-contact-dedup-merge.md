---
title: 'Detecção de Duplicatas e Merge de Contatos'
slug: 'contact-dedup-merge'
created: '2026-02-08'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Next.js 16 App Router', 'Supabase Postgres + RLS', 'TanStack Query v5', 'Tailwind 4', 'Lucide Icons', 'libphonenumber-js']
files_to_modify:
  - 'supabase/migrations/20260208200000_contact_dedup_merge.sql'
  - 'lib/query/queryKeys.ts'
  - 'lib/query/hooks/useDuplicateContactsQuery.ts'
  - 'lib/query/hooks/index.ts'
  - 'features/contacts/components/ContactsList.tsx'
  - 'features/contacts/components/DuplicatesBanner.tsx'
  - 'features/contacts/components/MergeContactsModal.tsx'
  - 'features/messaging/components/ContactPanel.tsx'
  - 'features/contacts/ContactsPage.tsx'
  - 'app/api/contacts/duplicates/route.ts'
  - 'app/api/contacts/merge/route.ts'
  - 'supabase/functions/messaging-webhook-meta/index.ts'
  - 'supabase/functions/messaging-webhook-zapi/index.ts'
code_patterns:
  - 'Query Keys Factory'
  - 'useQuery + Supabase RPC in queryFn'
  - 'useAuth() for organization_id'
  - 'Glass card pattern with Tailwind'
  - 'Barrel exports in lib/query/hooks/index.ts'
  - 'normalizePhoneE164() from lib/phone.ts'
review_findings_addressed:
  - 'F1: messaging_messages has no contact_id — removed phantom step'
  - 'F2: check_deal_duplicate trigger — disabled during merge'
  - 'F4: Race condition — FOR UPDATE locks with consistent ordering'
  - 'F5: Source = Target — guard added'
  - 'F6: Target already merged — guard added'
  - 'F7: UNION ALL duplicate groups — changed to UNION with graph grouping'
  - 'F8: webhook_events_in FK — added to merge'
  - 'F9: find_duplicates SECURITY DEFINER — changed to INVOKER'
  - 'F10: participant_contact_ids dedup — DISTINCT unnest'
  - 'F11: Webhook fix scope — expanded to Meta + Z-API'
  - 'F12: source_contact_id FK — added REFERENCES'
  - 'F13: GRANT EXECUTE — added for both RPCs'
  - 'F14: No index — added dedup indexes'
  - 'F16: Query invalidation — full list enumerated'
---

# Tech-Spec: Detecção de Duplicatas e Merge de Contatos

**Created:** 2026-02-08

## Overview

### Problem Statement

O CRM não detecta contatos duplicados. Uma pessoa com WhatsApp + Instagram + Email gera 3 contatos separados e 3 conversas desvinculadas. O time comercial perde contexto, não vê histórico unificado, e desperdiça tempo gerenciando duplicatas manualmente.

Adicionalmente, o webhook auto-create usa `.maybeSingle()` que silenciosamente retorna null quando >1 contato existe com mesmo phone, criando conversas orfãs sem `contact_id`.

### Solution

1. **RPC `find_duplicate_contacts()`** para detectar duplicatas por phone normalizado e email exato, com agrupamento que evita duplicação de pares
2. **RPC `merge_contacts()`** para merge atômico com row-level locks, reatribuindo todas as 8 tabelas com FK + dedup de arrays
3. **Tabela `contact_merge_log`** para auditoria completa
4. **UI**: Banner na ContactsPage + Badge no ContactPanel + Modal de merge com preview
5. **Fix webhook**: Tratar múltiplos contatos em Meta e Z-API handlers

### Scope

**In Scope:**
- Migration: `contact_merge_log` table, indexes, RPCs `find_duplicate_contacts` e `merge_contacts`, GRANT EXECUTE
- API routes: `/api/contacts/duplicates` (GET) e `/api/contacts/merge` (POST)
- Hooks: `useDuplicateContactsQuery()`, `useMergeContactsMutation()` com invalidação completa
- UI: `DuplicatesBanner`, `MergeContactsModal`, badge no `ContactPanel`
- Fix: webhook auto-create em Meta e Z-API handlers

**Out of Scope:**
- Fuzzy matching por nome (frágil, alta taxa de falso positivo)
- Auto-merge (sempre requer confirmação humana)
- Bulk merge (merge 1:1 por vez)
- Contact detail page dedicada
- Backfill de conversas orfãs existentes
- Fix webhook Resend (não faz auto-create de contatos)

## Context for Development

### FKs que Referenciam `contacts.id` (8 tabelas reais)

| Tabela | Coluna | ON DELETE | Ação no Merge |
|--------|--------|-----------|---------------|
| `deals` | `contact_id` | CASCADE | Reatribuir (disable duplicate trigger) |
| `messaging_conversations` | `contact_id` | SET NULL | Reatribuir |
| `voice_calls` | `contact_id` | (none) | Reatribuir |
| `activities` | `contact_id` | SET NULL | Reatribuir |
| `activities` | `participant_contact_ids[]` | N/A (array) | Replace + DISTINCT unnest |
| `ai_decisions` | `contact_id` | SET NULL | Reatribuir |
| `ai_audio_notes` | `contact_id` | SET NULL | Reatribuir |
| `leads` | `converted_to_contact_id` | (none) | Reatribuir |
| `webhook_events_in` | `created_contact_id` | SET NULL | Reatribuir |

**NOTA**: `messaging_messages` NÃO tem `contact_id` — mensagens são linkadas a contatos indiretamente via `conversation_id → messaging_conversations.contact_id`.

### Technical Decisions

- **Detecção**: Phone normalizado (exato) + email case-insensitive. Sem fuzzy matching de nome (alto falso positivo).
- **Merge direction**: Source → Target. Target mantém seus dados; campos nulos do target são preenchidos com source.
- **Soft merge**: Source recebe `merged_into_id = target.id` e `deleted_at = NOW()`. Queries existentes já filtram `deleted_at IS NULL`.
- **Row locks**: `SELECT ... FOR UPDATE` em ambos contatos, ordenados por ID (previne deadlocks).
- **Deal duplicate trigger**: Temporariamente desabilitado durante merge via `ALTER TABLE deals DISABLE TRIGGER check_deal_duplicate_trigger` dentro da função `SECURITY DEFINER`. Re-habilitado no final. Isso permite que deals do source sejam movidos para o target mesmo em stages conflitantes — o usuário pode resolver deals duplicados depois do merge.
- **`find_duplicate_contacts()` como SECURITY INVOKER**: A tabela `contacts` já tem RLS permissivo para authenticated users. Sem necessidade de SECURITY DEFINER.
- **Dedup de grupos**: `UNION` (não `UNION ALL`) + deduplicação de contact_ids no result evita que o mesmo par apareça 2x (phone + email).
- **Webhook fix**: `.maybeSingle()` → `.order('created_at').limit(1).maybeSingle()` pega o contato mais antigo (canonical).

## Implementation Plan

### Tasks

- [ ] **Task 1: Migration — tabela, indexes, RPCs, grants**
  - File: `supabase/migrations/20260208200000_contact_dedup_merge.sql`
  - Action:
    1. **Coluna `merged_into_id`** em contacts:
       ```sql
       ALTER TABLE contacts
         ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES contacts(id);

       CREATE INDEX IF NOT EXISTS idx_contacts_merged
         ON contacts(merged_into_id)
         WHERE merged_into_id IS NOT NULL;
       ```
    2. **Indexes para detecção de duplicatas** (evita full table scan):
       ```sql
       CREATE INDEX IF NOT EXISTS idx_contacts_phone_dedup
         ON contacts(organization_id, phone)
         WHERE phone IS NOT NULL AND phone != ''
           AND deleted_at IS NULL AND merged_into_id IS NULL;

       CREATE INDEX IF NOT EXISTS idx_contacts_email_dedup
         ON contacts(organization_id, LOWER(email))
         WHERE email IS NOT NULL AND email != ''
           AND deleted_at IS NULL AND merged_into_id IS NULL;
       ```
    3. **Tabela `contact_merge_log`**:
       ```sql
       CREATE TABLE IF NOT EXISTS public.contact_merge_log (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         organization_id UUID NOT NULL REFERENCES organizations(id),
         source_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE SET NULL,
         target_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE SET NULL,
         merged_by UUID NOT NULL REFERENCES profiles(id),
         source_snapshot JSONB NOT NULL,
         records_moved JSONB NOT NULL,
         created_at TIMESTAMPTZ DEFAULT NOW()
       );

       CREATE INDEX idx_merge_log_org ON contact_merge_log(organization_id);

       ALTER TABLE contact_merge_log ENABLE ROW LEVEL SECURITY;

       CREATE POLICY "Users can view merge logs of their org"
         ON contact_merge_log FOR SELECT
         USING (organization_id = (
           SELECT organization_id FROM profiles WHERE id = auth.uid()
         ));

       CREATE POLICY "Merge function can insert logs"
         ON contact_merge_log FOR INSERT
         WITH CHECK (true);
       ```
    4. **RPC `find_duplicate_contacts()`** (SECURITY INVOKER):
       ```sql
       CREATE OR REPLACE FUNCTION find_duplicate_contacts(p_org_id UUID)
       RETURNS JSONB
       LANGUAGE plpgsql
       SET search_path = public
       AS $$
       DECLARE
         v_result JSONB;
       BEGIN
         -- Verificar org membership
         IF NOT EXISTS (
           SELECT 1 FROM profiles WHERE id = auth.uid() AND organization_id = p_org_id
         ) THEN
           RAISE EXCEPTION 'Unauthorized';
         END IF;

         -- Encontrar grupos de duplicatas por phone OU email (UNION dedup)
         WITH raw_groups AS (
           SELECT
             'phone' as match_type,
             phone as match_value,
             array_agg(id ORDER BY created_at) as contact_ids,
             array_agg(name ORDER BY created_at) as contact_names,
             COUNT(*) as group_size
           FROM contacts
           WHERE organization_id = p_org_id
             AND deleted_at IS NULL
             AND merged_into_id IS NULL
             AND phone IS NOT NULL AND phone != ''
           GROUP BY phone
           HAVING COUNT(*) > 1

           UNION

           SELECT
             'email' as match_type,
             LOWER(email) as match_value,
             array_agg(id ORDER BY created_at) as contact_ids,
             array_agg(name ORDER BY created_at) as contact_names,
             COUNT(*) as group_size
           FROM contacts
           WHERE organization_id = p_org_id
             AND deleted_at IS NULL
             AND merged_into_id IS NULL
             AND email IS NOT NULL AND email != ''
           GROUP BY LOWER(email)
           HAVING COUNT(*) > 1
         )
         SELECT COALESCE(jsonb_agg(row_to_json(g)), '[]'::jsonb)
         INTO v_result
         FROM raw_groups g;

         RETURN v_result;
       END;
       $$;
       ```
    5. **RPC `merge_contacts()`** (SECURITY DEFINER para disable trigger + cross-table):
       ```sql
       CREATE OR REPLACE FUNCTION merge_contacts(
         p_source_id UUID,
         p_target_id UUID
       )
       RETURNS JSONB
       LANGUAGE plpgsql
       SECURITY DEFINER
       SET search_path = public
       AS $$
       DECLARE
         v_org_id UUID;
         v_caller_id UUID;
         v_source RECORD;
         v_target RECORD;
         v_moved JSONB DEFAULT '{}'::jsonb;
         v_count INTEGER;
       BEGIN
         v_caller_id := auth.uid();

         -- Guard: source = target
         IF p_source_id = p_target_id THEN
           RAISE EXCEPTION 'Cannot merge contact into itself';
         END IF;

         -- Row-level locks (ordered by ID to prevent deadlocks)
         IF p_source_id < p_target_id THEN
           SELECT * INTO v_source FROM contacts WHERE id = p_source_id AND deleted_at IS NULL FOR UPDATE;
           SELECT * INTO v_target FROM contacts WHERE id = p_target_id AND deleted_at IS NULL FOR UPDATE;
         ELSE
           SELECT * INTO v_target FROM contacts WHERE id = p_target_id AND deleted_at IS NULL FOR UPDATE;
           SELECT * INTO v_source FROM contacts WHERE id = p_source_id AND deleted_at IS NULL FOR UPDATE;
         END IF;

         IF v_source IS NULL OR v_target IS NULL THEN
           RAISE EXCEPTION 'Contact not found or already deleted';
         END IF;

         -- Guard: same org
         IF v_source.organization_id != v_target.organization_id THEN
           RAISE EXCEPTION 'Contacts from different organizations';
         END IF;

         v_org_id := v_target.organization_id;

         -- Guard: caller pertence à org
         IF NOT EXISTS (
           SELECT 1 FROM profiles WHERE id = v_caller_id AND organization_id = v_org_id
         ) THEN
           RAISE EXCEPTION 'Unauthorized';
         END IF;

         -- Guard: source not already merged
         IF v_source.merged_into_id IS NOT NULL THEN
           RAISE EXCEPTION 'Source contact already merged';
         END IF;

         -- Guard: target not already merged
         IF v_target.merged_into_id IS NOT NULL THEN
           RAISE EXCEPTION 'Target contact already merged';
         END IF;

         -- 1. Preencher campos nulos do target com dados do source
         UPDATE contacts SET
           email = COALESCE(email, v_source.email),
           phone = COALESCE(phone, v_source.phone),
           company_name = COALESCE(company_name, v_source.company_name),
           client_company_id = COALESCE(client_company_id, v_source.client_company_id),
           notes = CASE
             WHEN notes IS NULL THEN v_source.notes
             WHEN v_source.notes IS NOT NULL THEN LEFT(notes || E'\n---\n' || v_source.notes, 50000)
             ELSE notes
           END,
           updated_at = NOW()
         WHERE id = p_target_id;

         -- 2. Disable deal duplicate trigger (allows overlapping stages)
         ALTER TABLE deals DISABLE TRIGGER check_deal_duplicate_trigger;

         -- 3. Mover deals
         UPDATE deals SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('deals', v_count);

         -- Re-enable deal duplicate trigger
         ALTER TABLE deals ENABLE TRIGGER check_deal_duplicate_trigger;

         -- 4. Mover conversations
         UPDATE messaging_conversations SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('conversations', v_count);

         -- 5. Mover voice_calls
         UPDATE voice_calls SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('voice_calls', v_count);

         -- 6. Mover activities (contact_id)
         UPDATE activities SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('activities', v_count);

         -- 7. Dedup participant_contact_ids arrays (replace + distinct)
         UPDATE activities
         SET participant_contact_ids = (
           SELECT ARRAY(SELECT DISTINCT unnest(
             array_replace(participant_contact_ids, p_source_id, p_target_id)
           ))
         )
         WHERE p_source_id = ANY(participant_contact_ids);

         -- 8. Mover ai_decisions
         UPDATE ai_decisions SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('ai_decisions', v_count);

         -- 9. Mover ai_audio_notes
         UPDATE ai_audio_notes SET contact_id = p_target_id WHERE contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('ai_audio_notes', v_count);

         -- 10. Mover leads
         UPDATE leads SET converted_to_contact_id = p_target_id
           WHERE converted_to_contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('leads', v_count);

         -- 11. Mover webhook_events_in
         UPDATE webhook_events_in SET created_contact_id = p_target_id
           WHERE created_contact_id = p_source_id;
         GET DIAGNOSTICS v_count = ROW_COUNT;
         v_moved := v_moved || jsonb_build_object('webhook_events', v_count);

         -- 12. Marcar source como merged (soft delete)
         UPDATE contacts SET
           merged_into_id = p_target_id,
           deleted_at = NOW(),
           updated_at = NOW()
         WHERE id = p_source_id;

         -- 13. Log do merge
         INSERT INTO contact_merge_log (
           organization_id, source_contact_id, target_contact_id, merged_by,
           source_snapshot, records_moved
         ) VALUES (
           v_org_id, p_source_id, p_target_id, v_caller_id,
           row_to_json(v_source)::jsonb,
           v_moved
         );

         RETURN jsonb_build_object(
           'success', true,
           'targetId', p_target_id,
           'sourceId', p_source_id,
           'recordsMoved', v_moved
         );
       END;
       $$;
       ```
    6. **GRANT EXECUTE**:
       ```sql
       GRANT EXECUTE ON FUNCTION find_duplicate_contacts(UUID) TO authenticated;
       GRANT EXECUTE ON FUNCTION merge_contacts(UUID, UUID) TO authenticated;
       ```

- [ ] **Task 2: API route — buscar duplicatas**
  - File: `app/api/contacts/duplicates/route.ts` (NOVO)
  - Action: GET endpoint autenticado que chama `find_duplicate_contacts(orgId)`.
  - Notes: Auth check via `supabase.auth.getUser()`, profile lookup para `organization_id`.

- [ ] **Task 3: API route — executar merge**
  - File: `app/api/contacts/merge/route.ts` (NOVO)
  - Action: POST endpoint com body `{ sourceId, targetId }`, chama `merge_contacts()`.
  - Notes: Após sucesso, o client faz invalidação completa.

- [ ] **Task 4: Query keys + hooks**
  - Files: `lib/query/queryKeys.ts`, `lib/query/hooks/useDuplicateContactsQuery.ts` (NOVO), `lib/query/hooks/index.ts`
  - Action:
    1. Query keys:
       ```typescript
       contactDuplicates: {
         all: ['contactDuplicates'] as const,
         list: (orgId: string) => ['contactDuplicates', orgId] as const,
       },
       ```
    2. Types:
       ```typescript
       export interface DuplicateGroup {
         match_type: 'phone' | 'email';
         match_value: string;
         contact_ids: string[];
         contact_names: string[];
         group_size: number;
       }
       ```
    3. `useDuplicateContactsQuery()`: Chama RPC, retorna `DuplicateGroup[]`.
    4. `useMergeContactsMutation()`: Chama API, invalida queries completas:
       ```typescript
       onSuccess: () => {
         // Full invalidation list (8+ query families)
         queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
         queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
         queryClient.invalidateQueries({ queryKey: queryKeys.deals.lists() });
         queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
         queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.all });
         queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
         queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
         queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
         queryClient.invalidateQueries({ queryKey: queryKeys.contactDuplicates.all });
       }
       ```
    5. Barrel exports

- [ ] **Task 5: DuplicatesBanner component**
  - File: `features/contacts/components/DuplicatesBanner.tsx` (NOVO)
  - Action: Banner amber no topo da ContactsPage:
    - Mostra "X possíveis duplicatas encontradas"
    - Botão "Resolver" abre MergeContactsModal com primeira duplicata
    - Botão "X" dismisses (sessionStorage, key = `dedup_banner_dismissed`)
    - Estilo: `bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 rounded-xl p-4`

- [ ] **Task 6: MergeContactsModal component**
  - File: `features/contacts/components/MergeContactsModal.tsx` (NOVO)
  - Action: Modal com preview do merge:
    - **Header**: "Mesclar Contatos"
    - **Side-by-side**: 2 cards com dados (nome, email, phone, empresa, source)
    - **Selection**: Rádio para escolher primário. Default = mais antigo (primeiro do array).
    - **Preview**: Busca counts de deals, conversations, activities por contact_id (queries simples no client).
    - **Ações**: "Mesclar" (primary, amber), "Cancelar"
    - **Loading state** durante merge + **Success toast** + **auto-advance** para próxima duplicata
    - **Error handling**: Toast com mensagem (ex: "Source contact already merged")

- [ ] **Task 7: Badge de duplicata no ContactsList**
  - File: `features/contacts/components/ContactsList.tsx`
  - Action: Receber `duplicateContactIds: Set<string>` como prop. Na coluna Nome, após o nome:
    ```tsx
    {duplicateContactIds.has(contact.id) && (
      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
        Duplicata
      </span>
    )}
    ```

- [ ] **Task 8: Indicador no ContactPanel**
  - File: `features/messaging/components/ContactPanel.tsx`
  - Action: Receber `hasDuplicate: boolean` e `onResolveDuplicate: () => void` como props opcionais. No header:
    ```tsx
    {hasDuplicate && (
      <button onClick={onResolveDuplicate}
        className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline mt-1">
        <AlertTriangle size={12} />
        Possível duplicata — Resolver
      </button>
    )}
    ```

- [ ] **Task 9: Integrar na ContactsPage**
  - File: `features/contacts/ContactsPage.tsx`
  - Action:
    1. Import `DuplicatesBanner` e `MergeContactsModal`
    2. State: `selectedDuplicateGroup` para controlar o modal
    3. Construir `duplicateContactIds: Set<string>` a partir de `useDuplicateContactsQuery()`
    4. Passar set como prop para `ContactsList`
    5. Renderizar `<DuplicatesBanner>` no topo e `<MergeContactsModal>` controlado por state

- [ ] **Task 10: Fix webhook Meta**
  - File: `supabase/functions/messaging-webhook-meta/index.ts`
  - Action: Em `handleInboundMessage()` e `handleInstagramInboundMessage()`, trocar:
    ```typescript
    // ANTES
    .maybeSingle()
    // DEPOIS
    .order('created_at').limit(1).maybeSingle()
    ```
  - Notes: Pega o contato mais antigo quando há duplicatas.

- [ ] **Task 11: Fix webhook Z-API**
  - File: `supabase/functions/messaging-webhook-zapi/index.ts`
  - Action: Mesma correção do Task 10 em todas as chamadas `.maybeSingle()` para busca de contatos.

### Acceptance Criteria

- [ ] **AC 1**: Given contacts with the same normalized phone exist, when `find_duplicate_contacts()` runs, then they appear as a group with `match_type = 'phone'`.
- [ ] **AC 2**: Given contacts with the same email (case-insensitive) exist, then they appear as a group with `match_type = 'email'`.
- [ ] **AC 3**: Given a merge of source → target, when `merge_contacts()` executes, then deals, conversations, voice_calls, activities, ai_decisions, ai_audio_notes, leads, and webhook_events_in are reatributed to target.
- [ ] **AC 4**: Given source has notes and target has notes, then target's notes are appended with source's (capped at 50k chars).
- [ ] **AC 5**: Given source has email and target doesn't, then target inherits source's email.
- [ ] **AC 6**: Given merge completes, then source has `merged_into_id = target.id` and `deleted_at IS NOT NULL`.
- [ ] **AC 7**: Given merge completes, then `contact_merge_log` has record with `source_snapshot` and `records_moved`.
- [ ] **AC 8**: Given two users try to merge the same source simultaneously, then only one succeeds (FOR UPDATE lock).
- [ ] **AC 9**: Given source = target, then merge raises exception "Cannot merge contact into itself".
- [ ] **AC 10**: Given target is already merged, then merge raises exception.
- [ ] **AC 11**: Given ContactsPage loads with duplicates, then DuplicatesBanner shows count.
- [ ] **AC 12**: Given user clicks "Resolver", then MergeContactsModal opens with side-by-side preview and record counts.
- [ ] **AC 13**: Given user confirms merge, then success toast shows, all relevant queries are invalidated.
- [ ] **AC 14**: Given ContactPanel for a contact with duplicates, then amber indicator appears.
- [ ] **AC 15**: Given webhook receives message from phone matching >1 contact, then oldest contact is used.
- [ ] **AC 16**: Given contacts share both phone AND email, then they appear in only one duplicate group (not two).
- [ ] **AC 17**: Given source has deals in same stage as target, then merge succeeds (trigger temporarily disabled).

## Additional Context

### Testing Strategy

- **RPC tests (SQL)**:
  - 2 contacts same phone → `find_duplicate_contacts()` retorna grupo
  - Merge → verificar 8 tabelas foram reatribuídas
  - Merge source = target → exception
  - Merge already-merged → exception
  - Concurrent merge → second one fails or waits
  - Source deals overlap target stages → merge succeeds
- **Hook tests**: Mock `supabase.rpc()`, verificar invalidação completa
- **Component tests**: Banner com dados → visível; banner empty → hidden; modal render com 2 contatos

### Notes

- **`cascade_contact_delete` trigger**: Fires when `deleted_at` is set on source (step 12). Porém, activities já foram movidas (step 6), então o trigger encontra 0 rows. Sem impacto.
- **Deal duplicate trigger**: Temporariamente disabled/re-enabled dentro da transação SECURITY DEFINER. Após merge, deals duplicados na mesma stage do mesmo contato ficam visíveis — o usuário pode resolver manualmente (close/archive).
- **Phone normalization**: `normalizePhoneE164()` em `lib/phone.ts`. Normalização é feita no app, não no banco. Dados antigos com formato inconsistente podem não ser detectados por phone — email é mais confiável.
- **Performance**: Indexes `idx_contacts_phone_dedup` e `idx_contacts_email_dedup` garantem que `find_duplicate_contacts()` usa index scan, não full table scan. Seguro para 100k+ contatos.
