-- =====================================================================
-- إعدادات التشغيل من لوحة الإدارة (وضع الإرسال، سياسات الموافقة ...)
-- آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor (Role = postgres).
-- الجدول مقفول بـ RLS بدون policies: الخادم فقط (service_role) يقرأ ويكتب.
-- =====================================================================
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references agents(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
