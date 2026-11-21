-- Initial private-workspace schema. Share/member grants are added in later phases.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.workspace_role as enum ('owner', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_owner_idx on public.workspaces(owner_id);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint folders_parent_same_workspace_fk foreign key (workspace_id, parent_id)
    references public.folders(workspace_id, id) on delete cascade,
  unique (workspace_id, id)
);
create index folders_workspace_parent_idx on public.folders(workspace_id, parent_id) where deleted_at is null;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  folder_id uuid,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled' check (char_length(title) <= 500),
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  content_markdown text not null default '',
  search_text text not null default '',
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint documents_folder_same_workspace_fk foreign key (workspace_id, folder_id)
    references public.folders(workspace_id, id) on delete set null (folder_id),
  unique (workspace_id, id)
);
create index documents_owner_updated_idx on public.documents(owner_id, updated_at desc) where deleted_at is null;
create index documents_workspace_folder_idx on public.documents(workspace_id, folder_id) where deleted_at is null;
create index documents_search_text_trgm_idx on public.documents using gin (search_text extensions.gin_trgm_ops);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index tags_workspace_name_idx on public.tags(workspace_id, lower(name));

create table public.document_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null,
  tag_id uuid not null,
  primary key (document_id, tag_id),
  foreign key (workspace_id, document_id) references public.documents(workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references public.tags(workspace_id, id) on delete cascade
);
create index document_tags_tag_idx on public.document_tags(tag_id);

create or replace function private.is_workspace_owner(target_workspace uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$ select exists (
  select 1 from public.workspaces w
  where w.id = target_workspace and w.owner_id = (select auth.uid())
) $$;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare new_workspace_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.workspaces (owner_id, name)
  values (new.id, 'My workspace') returning id into new_workspace_id;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = pg_catalog
as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger folders_set_updated_at before update on public.folders
for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.tags enable row level security;
alter table public.document_tags enable row level security;

create policy "Profiles are private to their user" on public.profiles
for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Owners manage workspaces" on public.workspaces
for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "Workspace owners manage memberships" on public.workspace_members
for all to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create policy "Workspace owners manage folders" on public.folders
for all to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id) and created_by = (select auth.uid()));

create policy "Document owners manage documents" on public.documents
for all to authenticated using (owner_id = (select auth.uid()) and private.is_workspace_owner(workspace_id))
with check (owner_id = (select auth.uid()) and private.is_workspace_owner(workspace_id));

create policy "Workspace owners manage tags" on public.tags
for all to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create policy "Workspace owners manage document tags" on public.document_tags
for all to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members,
  public.folders, public.documents, public.tags, public.document_tags to authenticated;
grant usage, select on all sequences in schema public to authenticated;
