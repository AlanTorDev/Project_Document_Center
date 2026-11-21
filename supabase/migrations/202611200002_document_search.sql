-- Phase 3: private, paginated document search with trigram matching.
-- Trigrams work with both Vietnamese and English without assuming an English
-- stemming dictionary. The function is SECURITY INVOKER so RLS remains active.
create index if not exists documents_title_trgm_idx
  on public.documents using gin (title extensions.gin_trgm_ops);
create index if not exists folders_name_trgm_idx
  on public.folders using gin (name extensions.gin_trgm_ops);
create index if not exists tags_name_trgm_idx
  on public.tags using gin (name extensions.gin_trgm_ops);

create or replace function public.search_documents(
  search_query text,
  target_workspace uuid,
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  id uuid,
  title text,
  updated_at timestamptz,
  is_favorite boolean,
  is_archived boolean,
  folder_id uuid,
  folder_name text,
  tag_names text[],
  rank real
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with needle as (
    select trim(search_query) as value
  ), matches as (
    select d.id, d.title, d.updated_at, d.is_favorite, d.is_archived,
           d.folder_id, f.name as folder_name,
           coalesce(tags.names, array[]::text[]) as tag_names,
           greatest(
             extensions.similarity(lower(d.title), lower(n.value)),
             extensions.similarity(lower(d.search_text), lower(n.value)),
             coalesce(extensions.similarity(lower(f.name), lower(n.value)), 0),
             coalesce(tags.match_rank, 0)
           )::real as rank
    from public.documents d
    cross join needle n
    left join public.folders f on f.id = d.folder_id and f.workspace_id = d.workspace_id
    left join lateral (
      select array_agg(t.name order by t.name) as names,
             max(extensions.similarity(lower(t.name), lower(n.value))) as match_rank,
             bool_or(lower(t.name) like '%' || lower(n.value) || '%') as matches
      from public.document_tags dt
      join public.tags t on t.id = dt.tag_id and t.workspace_id = dt.workspace_id
      where dt.document_id = d.id and dt.workspace_id = d.workspace_id
    ) tags on true
    where d.workspace_id = target_workspace
      and d.deleted_at is null
      and n.value <> ''
      and (
        lower(d.title) like '%' || lower(n.value) || '%'
        or lower(d.search_text) like '%' || lower(n.value) || '%'
        or lower(coalesce(f.name, '')) like '%' || lower(n.value) || '%'
        or coalesce(tags.matches, false)
      )
  )
  select m.id, m.title, m.updated_at, m.is_favorite, m.is_archived,
         m.folder_id, m.folder_name, m.tag_names, m.rank
  from matches m
  order by m.rank desc, m.updated_at desc
  limit greatest(1, least(result_limit, 50))
  offset greatest(0, result_offset);
$$;

revoke all on function public.search_documents(text, uuid, integer, integer) from public, anon;
grant execute on function public.search_documents(text, uuid, integer, integer) to authenticated;
