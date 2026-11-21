-- Private image storage. Each object is keyed by owner UUID / document UUID / random filename.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-images', 'document-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_read_document_asset(owner_path text, document_path text)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare path_owner uuid; path_document uuid;
begin
  if owner_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or document_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  path_owner := owner_path::uuid;
  path_document := document_path::uuid;
  return exists (
    select 1 from public.documents d
    where d.id = path_document and d.owner_id = path_owner and d.deleted_at is null
      and (
        d.owner_id = (select auth.uid())
        or exists (
          select 1 from public.document_shares s
          where s.document_id = d.id and s.shared_with_user_id = (select auth.uid())
            and s.permission = 'viewer' and s.revoked_at is null
        )
        or exists (
          select 1 from public.document_share_links l
          where l.document_id = d.id and l.revoked_at is null
            and (l.expires_at is null or l.expires_at > now())
        )
      )
  );
end;
$$;

create or replace function private.can_manage_document_asset(owner_path text, document_path text)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare path_owner uuid; path_document uuid;
begin
  if auth.uid() is null
    or owner_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or document_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  path_owner := owner_path::uuid;
  path_document := document_path::uuid;
  return path_owner = (select auth.uid()) and exists (
    select 1 from public.documents d
    where d.id = path_document and d.owner_id = path_owner and d.deleted_at is null
  );
end;
$$;

revoke all on function private.can_read_document_asset(text, text) from public, anon, authenticated;
revoke all on function private.can_manage_document_asset(text, text) from public, anon, authenticated;
grant usage on schema private to anon;
grant execute on function private.can_read_document_asset(text, text) to anon, authenticated;
grant execute on function private.can_manage_document_asset(text, text) to authenticated;

drop policy if exists "Authorized users read document images" on storage.objects;
create policy "Authorized users read document images" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'document-images'
    and private.can_read_document_asset(split_part(name, '/', 1), split_part(name, '/', 2))
  );

drop policy if exists "Owners upload document images" on storage.objects;
create policy "Owners upload document images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'document-images'
    and private.can_manage_document_asset(split_part(name, '/', 1), split_part(name, '/', 2))
  );

drop policy if exists "Owners delete document images" on storage.objects;
create policy "Owners delete document images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'document-images'
    and private.can_manage_document_asset(split_part(name, '/', 1), split_part(name, '/', 2))
  );
