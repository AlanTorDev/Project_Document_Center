-- Scope anonymous image reads to the exact share link. Older links keep their
-- existing image paths until they are revoked or expire; newly-created links
-- use copies stored under their token hash.
alter table public.document_share_links
  add column if not exists asset_scope_ready boolean not null default false;

drop policy if exists "Authorized users read document images" on storage.objects;
drop function if exists private.can_read_document_asset(text, text);

create or replace function private.can_read_document_asset(object_path text)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  path_owner uuid;
  path_document uuid;
  path_scope text;
begin
  if object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp|gif)$' then
    path_owner := split_part(object_path, '/', 1)::uuid;
    path_document := split_part(object_path, '/', 2)::uuid;
    if auth.uid() is not null then
      return exists (
        select 1 from public.documents d
        where d.id = path_document and d.owner_id = path_owner and d.deleted_at is null
          and (d.owner_id = (select auth.uid()) or exists (
            select 1 from public.document_shares s
            where s.document_id = d.id and s.shared_with_user_id = (select auth.uid())
              and s.permission = 'viewer' and s.revoked_at is null
          ))
      );
    end if;
    return exists (
      select 1 from public.documents d
      join public.document_share_links l on l.document_id = d.id
      where d.id = path_document and d.owner_id = path_owner and d.deleted_at is null
        and l.asset_scope_ready = false and l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now())
    );
  end if;

  if object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp|gif)$' then
    path_owner := split_part(object_path, '/', 1)::uuid;
    path_document := split_part(object_path, '/', 2)::uuid;
    path_scope := split_part(object_path, '/', 3);
    return exists (
      select 1 from public.documents d
      where d.id = path_document and d.owner_id = path_owner and d.deleted_at is null
        and (
          d.owner_id = (select auth.uid())
          or exists (
            select 1 from public.document_share_links l
            where l.document_id = d.id and l.token_hash = path_scope
              and l.asset_scope_ready = true and l.revoked_at is null
              and (l.expires_at is null or l.expires_at > now())
          )
        )
    );
  end if;
  return false;
end;
$$;

revoke all on function private.can_read_document_asset(text) from public, anon, authenticated;
grant execute on function private.can_read_document_asset(text) to anon, authenticated;

create policy "Authorized users read document images" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'document-images'
    and private.can_read_document_asset(name)
  );

drop function public.get_shared_document(text);
create function public.get_shared_document(share_token text)
returns table (
  title text,
  content_json jsonb,
  content_markdown text,
  updated_at timestamptz,
  asset_scope text
)
language sql stable security definer
set search_path = pg_catalog, public, extensions
as $$
  select d.title, d.content_json, d.content_markdown, d.updated_at,
    case when l.asset_scope_ready then l.token_hash else null end
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
