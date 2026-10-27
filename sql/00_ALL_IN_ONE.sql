create extension if not exists pgcrypto;

do $$ begin create type agent_status  as enum ('active','inactive','on_break'); exception when duplicate_object then null; end $$;
do $$ begin create type agent_role    as enum ('agent','admin');               exception when duplicate_object then null; end $$;
do $$ begin create type msg_direction as enum ('inbound','outbound');          exception when duplicate_object then null; end $$;
do $$ begin create type msg_sender    as enum ('customer','agent','system','ai'); exception when duplicate_object then null; end $$;

create table if not exists departments (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name_ar    text not null,
  created_at timestamptz not null default now()
);
insert into departments (code, name_ar) values
  ('sales',            'المبيعات'),
  ('finance',          'المالية والأقساط'),
  ('site_visits',      'زوار المشروعات'),
  ('customer_service', 'خدمة العملاء'),
  ('management',       'الإدارة')
on conflict (code) do nothing;

create table if not exists agents (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users(id) on delete set null,
  name               text not null,
  phone              text not null,
  department_id      uuid not null references departments(id),
  status             agent_status not null default 'active',
  role               agent_role   not null default 'agent',
  approval_status    text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  approved_by        uuid references agents(id) on delete set null,
  approved_at        timestamptz,
  created_by         uuid references agents(id) on delete set null,
  phone_verified_at  timestamptz,
  verify_code_hash   text,
  verify_expires_at  timestamptz,
  verify_attempts    int not null default 0,
  last_assigned_at   timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agents' and column_name = 'phone_verified_at') then
    alter table agents add column phone_verified_at timestamptz;
    update agents set phone_verified_at = now();
  end if;
end $$;
alter table agents
  add column if not exists approval_status  text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  add column if not exists approved_by      uuid references agents(id) on delete set null,
  add column if not exists approved_at      timestamptz,
  add column if not exists created_by       uuid references agents(id) on delete set null,
  add column if not exists verify_code_hash text,
  add column if not exists verify_expires_at timestamptz,
  add column if not exists verify_attempts  int not null default 0;

create unique index if not exists agents_phone_uq on agents(phone) where deleted_at is null;
create index if not exists agents_pool_idx on agents(department_id, status, last_assigned_at) where deleted_at is null;

create table if not exists contacts (
  id                uuid primary key default gen_random_uuid(),
  phone             text unique not null,
  name              text,
  department_id     uuid references departments(id),
  assigned_agent_id uuid references agents(id) on delete set null,
  ai_stage          text not null default 'new' check (ai_stage in ('new','qualifying','routed')),
  ai_summary        text,
  last_inbound_at   timestamptz,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists contacts_agent_idx on contacts(assigned_agent_id, last_message_at desc);
create index if not exists contacts_dept_idx  on contacts(department_id, last_message_at desc);

create table if not exists messages (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts(id) on delete cascade,
  agent_id       uuid references agents(id) on delete set null,
  department_id  uuid references departments(id),
  message_body   text not null,
  direction      msg_direction not null,
  sender_type    msg_sender    not null,
  wa_message_id  text unique,
  status         text not null default 'received',
  error          text,
  payload        jsonb,
  "timestamp"    timestamptz not null default now()
);
create index if not exists messages_contact_idx on messages(contact_id, "timestamp" desc);

create table if not exists outbound_approvals (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null unique references messages(id) on delete cascade,
  requested_by  uuid references agents(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references agents(id) on delete set null,
  reviewed_at   timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now()
);
create index if not exists outbound_approvals_pending_idx on outbound_approvals(status, created_at);

create or replace view conversation_summaries with (security_invoker = true) as
select c.id as contact_id, c.phone, c.name, c.department_id, c.assigned_agent_id,
       c.last_inbound_at, c.last_message_at,
       lm.message_body as last_message, lm.direction as last_direction, lm."timestamp" as last_timestamp
from contacts c
left join lateral (
  select m.message_body, m.direction, m."timestamp"
  from messages m where m.contact_id = c.id
  order by m."timestamp" desc limit 1
) lm on true;

create or replace function pick_next_agent(p_department uuid)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_department::text, 0));
  select id into v_id
    from agents
   where department_id = p_department
     and status = 'active'
     and approval_status = 'approved'
     and phone_verified_at is not null
     and deleted_at is null
   order by last_assigned_at asc nulls first, created_at asc, id asc
   limit 1;
  if v_id is not null then
    update agents set last_assigned_at = clock_timestamp() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function assign_contact(p_contact uuid, p_department uuid, p_fallback uuid default null)
returns table (out_department_id uuid, out_agent_id uuid)
language plpgsql as $$
declare v_agent uuid; v_dept uuid := p_department;
begin
  v_agent := pick_next_agent(p_department);
  if v_agent is null and p_fallback is not null and p_fallback <> p_department then
    v_agent := pick_next_agent(p_fallback);
    if v_agent is not null then v_dept := p_fallback; end if;
  end if;
  update contacts set department_id = v_dept, assigned_agent_id = v_agent where id = p_contact;
  return query select v_dept, v_agent;
end $$;

create or replace function my_agent_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from agents where auth_user_id = auth.uid() and deleted_at is null limit 1 $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from agents
                  where auth_user_id = auth.uid() and role = 'admin'
                    and status <> 'inactive' and approval_status = 'approved' and deleted_at is null) $$;

alter table departments        enable row level security;
alter table agents             enable row level security;
alter table contacts           enable row level security;
alter table messages           enable row level security;
alter table outbound_approvals enable row level security;

drop policy if exists dep_read on departments;
create policy dep_read on departments for select to authenticated using (true);

drop policy if exists agents_read on agents;
create policy agents_read on agents for select to authenticated
  using (is_admin() or id = my_agent_id());

drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts for select to authenticated
  using (is_admin() or assigned_agent_id = my_agent_id());

drop policy if exists messages_read on messages;
create policy messages_read on messages for select to authenticated
  using (is_admin() or exists (select 1 from contacts c
          where c.id = messages.contact_id and c.assigned_agent_id = my_agent_id()));

drop policy if exists outbound_approvals_admin_read on outbound_approvals;
create policy outbound_approvals_admin_read on outbound_approvals for select to authenticated using (is_admin());

do $$ begin alter publication supabase_realtime add table messages;           exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table contacts;           exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table outbound_approvals; exception when duplicate_object then null; end $$;

alter table contacts add column if not exists channel text not null default 'whatsapp' check (channel in ('whatsapp','telegram','instagram','messenger'));
alter table contacts add column if not exists tags text[] not null default '{}';
alter table contacts add column if not exists ai_summary text;
alter table contacts add column if not exists ai_intent text;
create index if not exists contacts_channel_idx on contacts(channel);

-- إعدادات التشغيل من لوحة الإدارة
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references agents(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
