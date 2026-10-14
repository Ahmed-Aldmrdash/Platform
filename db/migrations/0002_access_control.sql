-- Access control.
--
-- The application connects as `hse_app`, a login role that can read and
-- write the hse tables and nothing else (no DDL, no other schemas). The hse
-- schema is not exposed through the Supabase Data API, and RLS is enabled on
-- every table with a single policy for hse_app, so the anon/authenticated
-- API roles can never reach this data even if the schema gets exposed later.
--
-- The role is created without a password; set one out of band:
--   alter role hse_app with password '<generated secret>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hse_app') then
    create role hse_app login noinherit;
  end if;
end
$$;

revoke all on schema hse from public;
grant usage on schema hse to hse_app;

grant select, insert, update, delete on all tables in schema hse to hse_app;
revoke insert, update, delete on hse.schema_migrations from hse_app;
grant execute on all functions in schema hse to hse_app;
alter default privileges in schema hse grant select, insert, update, delete on tables to hse_app;
alter default privileges in schema hse grant execute on functions to hse_app;

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'hse'
  loop
    execute format('alter table hse.%I enable row level security', t.tablename);
    execute format('drop policy if exists app_access on hse.%I', t.tablename);
    execute format(
      'create policy app_access on hse.%I for all to hse_app using (true) with check (true)',
      t.tablename
    );
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema hse from anon, authenticated';
    execute 'revoke all on schema hse from anon, authenticated';
  end if;
end
$$;
