-- Direct read-only sharing with an existing Supabase Auth account.
create table public.document_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'viewer' check (permission = 'viewer'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (document_id, shared_with_user_id)
);
create index document_shares_recipient_idx
  on public.document_shares(shared_with_user_id, created_at desc) where revoked_at is null;

alter table public.document_shares enable row level security;
revoke all on table public.document_shares from public, anon, authenticated;
grant select on public.document_shares to authenticated;
grant update (revoked_at) on public.document_shares to authenticated;

-- SECURITY DEFINER helpers prevent policy recursion between documents and shares.
create or replace function private.is_document_owner(target_document uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = target_document and d.owner_id = (select auth.uid())
  );
$$;
revoke all on function private.is_document_owner(uuid) from public, anon;
grant execute on function private.is_document_owner(uuid) to authenticated;

create policy "Owners view document shares" on public.document_shares
  for select to authenticated using (private.is_document_owner(document_id));
create policy "Owners revoke document shares" on public.document_shares
  for update to authenticated using (private.is_document_owner(document_id) and revoked_at is null)
  with check (private.is_document_owner(document_id) and revoked_at is not null);

-- Email lookup stays server-side. The function only returns whether a registered
-- account was found; owner authorization is checked before reading auth.users.
create or replace function public.share_document_with_email(target_document uuid, target_email text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private, auth
as $$
declare recipient_id uuid;
begin
  if auth.uid() is null or not private.is_document_owner(target_document) then
    raise exception using errcode = '42501', message = 'Not authorized to share this document.';
  end if;
  if exists (select 1 from public.documents d where d.id = target_document and d.deleted_at is not null) then
    raise exception using errcode = '42501', message = 'This document is not available for sharing.';
  end if;

  select u.id into recipient_id from auth.users u
  where lower(u.email) = lower(trim(target_email)) and u.id <> auth.uid()
  limit 1;
  if recipient_id is null then return false; end if;

  insert into public.document_shares(document_id, shared_with_user_id, permission, created_by)
  values (target_document, recipient_id, 'viewer', auth.uid())
  on conflict (document_id, shared_with_user_id) do update
    set permission = 'viewer', created_by = excluded.created_by, created_at = now(), revoked_at = null;
  return true;
end;
$$;
revoke all on function public.share_document_with_email(uuid, text) from public, anon, authenticated;
grant execute on function public.share_document_with_email(uuid, text) to authenticated;

-- Only the document owner may see the recipient email addresses.
create or replace function public.get_document_shares(target_document uuid)
returns table (share_id uuid, email text, created_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not private.is_document_owner(target_document) then return; end if;
  return query
    select s.id, u.email::text, s.created_at, s.revoked_at
    from public.document_shares s
    join auth.users u on u.id = s.shared_with_user_id
    where s.document_id = target_document
    order by s.created_at desc;
end;
$$;
revoke all on function public.get_document_shares(uuid) from public, anon, authenticated;
grant execute on function public.get_document_shares(uuid) to authenticated;

-- Shared readers use narrow, read-only RPCs rather than selecting document rows
-- directly, so workspace IDs, owner IDs, and indexing metadata stay private.
create or replace function public.get_registered_shared_document(target_document uuid)
returns table (id uuid, title text, content_json jsonb, updated_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select d.id, d.title, d.content_json, d.updated_at
  from public.document_shares s
  join public.documents d on d.id = s.document_id
  where s.document_id = target_document
    and s.shared_with_user_id = (select auth.uid())
    and s.permission = 'viewer' and s.revoked_at is null
    and d.deleted_at is null
  limit 1;
$$;
revoke all on function public.get_registered_shared_document(uuid) from public, anon;
grant execute on function public.get_registered_shared_document(uuid) to authenticated;

create or replace function public.list_shared_documents()
returns table (id uuid, title text, updated_at timestamptz, is_favorite boolean, is_archived boolean, folder_id uuid)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select d.id, d.title, d.updated_at, false, false, null::uuid
  from public.document_shares s
  join public.documents d on d.id = s.document_id
  where s.shared_with_user_id = (select auth.uid())
    and s.permission = 'viewer' and s.revoked_at is null
    and d.deleted_at is null
  order by d.updated_at desc
  limit 100;
$$;
revoke all on function public.list_shared_documents() from public, anon;
grant execute on function public.list_shared_documents() to authenticated;

-- Search only documents shared with the current account; private workspace
-- search continues to use search_documents(target_workspace, ...).
create or replace function public.search_shared_documents(
  search_query text,
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  id uuid, title text, updated_at timestamptz, is_favorite boolean,
  is_archived boolean, folder_id uuid, folder_name text, tag_names text[], rank real
)
language sql stable security definer
set search_path = pg_catalog, public, extensions
as $$
  with needle as (select lower(trim(search_query)) as value),
  matches as (
    select d.id, d.title, d.updated_at, d.is_favorite, d.is_archived,
      null::uuid as folder_id, null::text as folder_name, array[]::text[] as tag_names,
      greatest(extensions.similarity(lower(d.title), n.value), extensions.similarity(lower(d.search_text), n.value))::real as rank
    from public.documents d
    join public.document_shares s on s.document_id = d.id
    cross join needle n
    where s.shared_with_user_id = (select auth.uid()) and s.revoked_at is null
      and d.deleted_at is null and d.owner_id <> (select auth.uid()) and n.value <> ''
      and (lower(d.title) like '%' || n.value || '%' or lower(d.search_text) like '%' || n.value || '%')
  )
  select m.id, m.title, m.updated_at, m.is_favorite, m.is_archived,
    m.folder_id, m.folder_name, m.tag_names, m.rank
  from matches m order by m.rank desc, m.updated_at desc
  limit greatest(1, least(result_limit, 50)) offset greatest(0, result_offset);
$$;
revoke all on function public.search_shared_documents(text, integer, integer) from public, anon;
grant execute on function public.search_shared_documents(text, integer, integer) to authenticated;
