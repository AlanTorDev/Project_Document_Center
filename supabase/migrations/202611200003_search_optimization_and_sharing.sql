-- Search indexes on the normalized expressions used by the query.
create index if not exists documents_title_lower_trgm_idx
  on public.documents using gin (lower(title) extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists documents_search_lower_trgm_idx
  on public.documents using gin (lower(search_text) extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists folders_name_lower_trgm_idx
  on public.folders using gin (lower(name) extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists tags_name_lower_trgm_idx
  on public.tags using gin (lower(name) extensions.gin_trgm_ops);
drop index if exists public.documents_title_trgm_idx;
drop index if exists public.documents_search_text_trgm_idx;
drop index if exists public.folders_name_trgm_idx;
drop index if exists public.tags_name_trgm_idx;

-- Narrow candidate rows through indexed substring matches before calculating
-- relevance and collecting tag labels.
create or replace function public.search_documents(
  search_query text,
  target_workspace uuid,
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  id uuid, title text, updated_at timestamptz, is_favorite boolean,
  is_archived boolean, folder_id uuid, folder_name text, tag_names text[], rank real
)
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with needle as (select lower(trim(search_query)) as value),
  candidate_ids as (
    select d.id from public.documents d cross join needle n
      where d.workspace_id = target_workspace and d.deleted_at is null and n.value <> ''
        and lower(d.title) like '%' || n.value || '%'
    union
    select d.id from public.documents d cross join needle n
      where d.workspace_id = target_workspace and d.deleted_at is null and n.value <> ''
        and lower(d.search_text) like '%' || n.value || '%'
    union
    select d.id from public.documents d
      join public.folders f on f.id = d.folder_id and f.workspace_id = d.workspace_id
      cross join needle n
      where d.workspace_id = target_workspace and d.deleted_at is null and f.deleted_at is null
        and n.value <> '' and lower(f.name) like '%' || n.value || '%'
    union
    select d.id from public.documents d
      join public.document_tags dt on dt.document_id = d.id and dt.workspace_id = d.workspace_id
      join public.tags t on t.id = dt.tag_id and t.workspace_id = dt.workspace_id
      cross join needle n
      where d.workspace_id = target_workspace and d.deleted_at is null
        and n.value <> '' and lower(t.name) like '%' || n.value || '%'
  ),
  matches as (
    select d.id, d.title, d.updated_at, d.is_favorite, d.is_archived, d.folder_id,
      f.name as folder_name, coalesce(tags.names, array[]::text[]) as tag_names,
      greatest(
        extensions.similarity(lower(d.title), n.value),
        extensions.similarity(lower(d.search_text), n.value),
        coalesce(extensions.similarity(lower(f.name), n.value), 0),
        coalesce(tags.match_rank, 0)
      )::real as rank
    from candidate_ids c
    join public.documents d on d.id = c.id and d.workspace_id = target_workspace
    cross join needle n
    left join public.folders f on f.id = d.folder_id and f.workspace_id = d.workspace_id
    left join lateral (
      select array_agg(t.name order by t.name) as names,
        max(extensions.similarity(lower(t.name), n.value)) as match_rank
      from public.document_tags dt
      join public.tags t on t.id = dt.tag_id and t.workspace_id = dt.workspace_id
      where dt.document_id = d.id and dt.workspace_id = d.workspace_id
    ) tags on true
  )
  select m.id, m.title, m.updated_at, m.is_favorite, m.is_archived,
    m.folder_id, m.folder_name, m.tag_names, m.rank
  from matches m
  order by m.rank desc, m.updated_at desc
  limit greatest(1, least(result_limit, 50))
  offset greatest(0, result_offset);
$$;

create table if not exists public.document_share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists document_share_links_document_idx
  on public.document_share_links(document_id, created_at desc);
create index if not exists document_share_links_active_token_idx
  on public.document_share_links(token_hash) where revoked_at is null;

alter table public.document_share_links enable row level security;
revoke all on table public.document_share_links from public, anon, authenticated;
create policy "Owners view document share links" on public.document_share_links
  for select to authenticated using (
    exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );
create policy "Owners create document share links" on public.document_share_links
  for insert to authenticated with check (
    created_by = (select auth.uid()) and revoked_at is null and
    exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()) and d.deleted_at is null)
  );
create policy "Owners revoke document share links" on public.document_share_links
  for update to authenticated using (
    revoked_at is null and
    exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  ) with check (
    created_by = (select auth.uid()) and revoked_at is not null and
    exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
  );
grant select, insert on public.document_share_links to authenticated;
grant update (revoked_at) on public.document_share_links to authenticated;

-- This narrowly-scoped function is the only public read path for a shared
-- document. The database stores only SHA-256 token hashes.
create or replace function public.get_shared_document(share_token text)
returns table (title text, content_json jsonb, content_markdown text, updated_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, public, extensions
as $$
  select d.title, d.content_json, d.content_markdown, d.updated_at
  from public.document_share_links l
  join public.documents d on d.id = l.document_id
  where share_token ~ '^[A-Za-z0-9_-]{43}$'
    and l.token_hash = encode(extensions.digest(share_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and d.deleted_at is null
  limit 1;
$$;
revoke all on function public.get_shared_document(text) from public, authenticated, anon;
grant execute on function public.get_shared_document(text) to anon, authenticated;
