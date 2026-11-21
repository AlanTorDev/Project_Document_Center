-- Atomically replace the tag set for a document the caller owns.
create or replace function public.set_document_tags(target_document uuid, requested_names text[])
returns table (id uuid, name text)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_workspace uuid;
  clean_names text[];
  current_name text;
  current_tag_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to manage document tags.';
  end if;

  select d.workspace_id into target_workspace
  from public.documents d
  where d.id = target_document and d.owner_id = (select auth.uid()) and d.deleted_at is null;
  if target_workspace is null then
    raise exception using errcode = '42501', message = 'Document not found or not owned by the current user.';
  end if;

  select array_agg(items.display_name order by items.normalized_name)
  into clean_names
  from (
    select distinct on (tag_values.normalized_name) tag_values.normalized_name, tag_values.display_name
    from (
      select lower(trim(input_name)) as normalized_name, trim(input_name) as display_name, ordinal
      from unnest(coalesce(requested_names, array[]::text[])) with ordinality as names(input_name, ordinal)
      where trim(input_name) <> ''
    ) tag_values
    order by tag_values.normalized_name, tag_values.ordinal
  ) items;
  clean_names := coalesce(clean_names, array[]::text[]);

  if cardinality(clean_names) > 20 then
    raise exception using errcode = '22023', message = 'A document can have at most 20 tags.';
  end if;
  if exists (select 1 from unnest(clean_names) as n(value) where char_length(n.value) > 80) then
    raise exception using errcode = '22023', message = 'Tag names must be 80 characters or fewer.';
  end if;

  delete from public.document_tags dt
  where dt.document_id = target_document and dt.workspace_id = target_workspace;

  foreach current_name in array clean_names loop
    insert into public.tags(workspace_id, name)
    values (target_workspace, current_name)
    on conflict (workspace_id, (lower(name))) do nothing;

    select t.id into current_tag_id
    from public.tags t
    where t.workspace_id = target_workspace and lower(t.name) = lower(current_name);

    insert into public.document_tags(workspace_id, document_id, tag_id)
    values (target_workspace, target_document, current_tag_id);
  end loop;

  return query
    select t.id, t.name
    from public.document_tags dt
    join public.tags t on t.id = dt.tag_id and t.workspace_id = dt.workspace_id
    where dt.workspace_id = target_workspace and dt.document_id = target_document
    order by lower(t.name);
end;
$$;
revoke all on function public.set_document_tags(uuid, text[]) from public, anon;
grant execute on function public.set_document_tags(uuid, text[]) to authenticated;
