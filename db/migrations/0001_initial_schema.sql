-- HSE Platform — initial schema.
--
-- Every business entity lives in its own table. The full record is kept in
-- `data` (jsonb) so the application can round-trip it exactly, and the fields
-- used for filtering and reporting are exposed as typed, indexed generated
-- columns. `position` preserves the ordering the application relies on.

create schema if not exists hse;

create table if not exists hse.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- Casting helpers used by generated columns. They never raise, so a malformed
-- value in a record can't block a write.
create or replace function hse.to_date_safe(v text) returns date
language plpgsql immutable parallel safe
set search_path = ''
as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return to_date(substr(v, 1, 10), 'YYYY-MM-DD');
exception when others then
  return null;
end
$$;

create or replace function hse.to_timestamptz_safe(v text) returns timestamptz
language plpgsql immutable parallel safe
set search_path = ''
set timezone = 'UTC'
as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return v::timestamptz;
exception when others then
  return null;
end
$$;

create or replace function hse.to_int_safe(v text) returns integer
language plpgsql immutable parallel safe
set search_path = ''
as $$
begin
  if v is null or v !~ '^\s*-?\d{1,9}\s*$' then
    return null;
  end if;
  return v::integer;
end
$$;

-- ── Accounts ────────────────────────────────────────────────────────────────

create table if not exists hse.users (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  username    text generated always as (data ->> 'username') stored,
  role        text generated always as (data ->> 'role') stored,
  department  text generated always as (data ->> 'department') stored,
  emp_code    text generated always as (data ->> 'empCode') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists users_username_key on hse.users (username);
create index if not exists users_role_idx on hse.users (role);
create index if not exists users_position_idx on hse.users (position);

create table if not exists hse.employees (
  emp_code    text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  name        text generated always as (data ->> 'name') stored,
  department  text generated always as (data ->> 'department') stored,
  job_title   text generated always as (data ->> 'jobTitle') stored,
  phone       text generated always as (data ->> 'phone') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists employees_department_idx on hse.employees (department);
create index if not exists employees_position_idx on hse.employees (position);

create table if not exists hse.worker_credentials (
  emp_code    text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists hse.push_subscriptions (
  endpoint    text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  role        text generated always as (data ->> 'role') stored,
  emp_code    text generated always as (data ->> 'empCode') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_emp_code_idx on hse.push_subscriptions (emp_code);

-- ── Work permits ────────────────────────────────────────────────────────────

create table if not exists hse.permits (
  id           text primary key,
  position     bigint not null,
  data         jsonb not null check (jsonb_typeof(data) = 'object'),
  permit_date  date generated always as (hse.to_date_safe(data ->> 'date')) stored,
  department   text generated always as (data ->> 'department') stored,
  status       text generated always as (data ->> 'status') stored,
  type_key     text generated always as (data ->> 'typeKey') stored,
  worker_name  text generated always as (data ->> 'workerName') stored,
  employee_id  text generated always as (nullif(ltrim(regexp_replace(coalesce(data ->> 'employeeId', ''), '[^0-9]', '', 'g'), '0'), '')) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists permits_position_idx on hse.permits (position);
create index if not exists permits_status_idx on hse.permits (status);
create index if not exists permits_department_date_idx on hse.permits (department, permit_date);
create index if not exists permits_date_idx on hse.permits (permit_date);
create index if not exists permits_employee_id_idx on hse.permits (employee_id);
create index if not exists permits_type_key_idx on hse.permits (type_key);

-- ── Hazard reports ──────────────────────────────────────────────────────────

create table if not exists hse.hazards (
  id            text primary key,
  position      bigint not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  report_date   date generated always as (hse.to_date_safe(data ->> 'date')) stored,
  emp_code      text generated always as (data ->> 'empCode') stored,
  department    text generated always as (data ->> 'department') stored,
  status        text generated always as (data ->> 'status') stored,
  risk_level    text generated always as (data ->> 'riskLevel') stored,
  submitted_at  timestamptz generated always as (hse.to_timestamptz_safe(data ->> 'submittedAt')) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists hazards_position_idx on hse.hazards (position);
create index if not exists hazards_status_idx on hse.hazards (status);
create index if not exists hazards_department_date_idx on hse.hazards (department, report_date);
create index if not exists hazards_emp_code_idx on hse.hazards (emp_code);
create index if not exists hazards_risk_level_idx on hse.hazards (risk_level);

-- ── Training ────────────────────────────────────────────────────────────────

create table if not exists hse.trainings (
  id             text primary key,
  position       bigint not null,
  data           jsonb not null check (jsonb_typeof(data) = 'object'),
  training_date  date generated always as (hse.to_date_safe(data ->> 'date')) stored,
  status         text generated always as (data ->> 'status') stored,
  topic          text generated always as (data ->> 'topic') stored,
  trainer_code   text generated always as (data ->> 'trainerCode') stored,
  target_dept    text generated always as (data ->> 'targetDept') stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists trainings_position_idx on hse.trainings (position);
create index if not exists trainings_date_idx on hse.trainings (training_date);
create index if not exists trainings_status_idx on hse.trainings (status);

create table if not exists hse.training_requests (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  emp_code    text generated always as (data ->> 'empCode') stored,
  status      text generated always as (data ->> 'status') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists training_requests_emp_code_idx on hse.training_requests (emp_code);
create index if not exists training_requests_position_idx on hse.training_requests (position);

create table if not exists hse.training_topics (
  title       text primary key,
  position    bigint not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Emergency drills & penalties ────────────────────────────────────────────

create table if not exists hse.drills (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  drill_date  date generated always as (hse.to_date_safe(data ->> 'date')) stored,
  status      text generated always as (data ->> 'status') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists drills_position_idx on hse.drills (position);
create index if not exists drills_date_idx on hse.drills (drill_date);

create table if not exists hse.penalties (
  id            text primary key,
  position      bigint not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  emp_code      text generated always as (data ->> 'empCode') stored,
  department    text generated always as (data ->> 'department') stored,
  penalty_date  date generated always as (hse.to_date_safe(data ->> 'date')) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists penalties_position_idx on hse.penalties (position);
create index if not exists penalties_emp_code_idx on hse.penalties (emp_code);
create index if not exists penalties_date_idx on hse.penalties (penalty_date);

-- ── Monthly inspections ─────────────────────────────────────────────────────

create table if not exists hse.inspection_sections (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  category    text generated always as (data ->> 'category') stored,
  name        text generated always as (data ->> 'name') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists inspection_sections_position_idx on hse.inspection_sections (position);

create table if not exists hse.inspection_items (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  section_id  text generated always as (data ->> 'sectionId') stored,
  department  text generated always as (data ->> 'department') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists inspection_items_position_idx on hse.inspection_items (position);
create index if not exists inspection_items_section_id_idx on hse.inspection_items (section_id);

create table if not exists hse.inspection_records (
  id          text primary key,
  position    bigint not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  section_id  text generated always as (data ->> 'sectionId') stored,
  item_id     text generated always as (data ->> 'itemId') stored,
  year        integer generated always as (hse.to_int_safe(data ->> 'year')) stored,
  month       integer generated always as (hse.to_int_safe(data ->> 'month')) stored,
  status      text generated always as (data ->> 'status') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists inspection_records_position_idx on hse.inspection_records (position);
create index if not exists inspection_records_item_period_idx on hse.inspection_records (item_id, year, month);
create index if not exists inspection_records_section_period_idx on hse.inspection_records (section_id, year, month);

-- ── Notifications & audit trail ─────────────────────────────────────────────

create table if not exists hse.notifications (
  id               text primary key,
  position         bigint not null,
  data             jsonb not null check (jsonb_typeof(data) = 'object'),
  type             text generated always as (data ->> 'type') stored,
  target_role      text generated always as (data ->> 'targetRole') stored,
  target_emp_code  text generated always as (data ->> 'targetEmpCode') stored,
  sent_at          timestamptz generated always as (hse.to_timestamptz_safe(data ->> 'createdAt')) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists notifications_position_idx on hse.notifications (position);
create index if not exists notifications_target_emp_code_idx on hse.notifications (target_emp_code);

create table if not exists hse.audit_log (
  id           text primary key,
  position     bigint not null,
  data         jsonb not null check (jsonb_typeof(data) = 'object'),
  entity_type  text generated always as (data ->> 'entityType') stored,
  entity_id    text generated always as (data ->> 'entityId') stored,
  action       text generated always as (data ->> 'action') stored,
  actor_id     text generated always as (data ->> 'actorId') stored,
  occurred_at  timestamptz generated always as (hse.to_timestamptz_safe(data ->> 'timestamp')) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists audit_log_position_idx on hse.audit_log (position);
create index if not exists audit_log_entity_idx on hse.audit_log (entity_type, entity_id);
create index if not exists audit_log_occurred_at_idx on hse.audit_log (occurred_at);

-- ── Settings & uploaded files ───────────────────────────────────────────────

create table if not exists hse.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists hse.files (
  path          text primary key,
  content_type  text not null,
  size_bytes    integer not null check (size_bytes >= 0),
  content       bytea not null,
  created_at    timestamptz not null default now()
);
