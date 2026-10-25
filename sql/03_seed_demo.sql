-- =====================================================================
-- بيانات تجريبية (اختياري) — للاستخدام في مشروع Supabase خاص بالتجارب فقط.
-- أرقام وهمية تبدأ بـ 2010000000 والأسماء فيها "(تجريبي)" ليسهل حذفها بـ 04_cleanup_demo.sql.
-- ⚠ الموظفون هنا معتمدون وموثّقون ومتاحون للتوزيع: لو دخلوا قاعدة الإنتاج
--   قد يستلمون عملاء حقيقيين. لا تشغّله على قاعدة العمل الفعلية.
-- =====================================================================
insert into agents (name, phone, department_id, status, role, approval_status, phone_verified_at)
select v.name, v.phone, d.id, v.status::agent_status, v.role::agent_role, 'approved', now()
from (values
  ('أحمد (تجريبي)',        '201000000001', 'sales',            'active',   'agent'),
  ('منى (تجريبي)',         '201000000002', 'sales',            'active',   'agent'),
  ('كريم (تجريبي)',        '201000000003', 'sales',            'on_break', 'agent'),
  ('هالة (تجريبي)',        '201000000004', 'finance',          'active',   'agent'),
  ('طارق (تجريبي)',        '201000000005', 'site_visits',      'active',   'agent'),
  ('سارة (تجريبي)',        '201000000006', 'customer_service', 'active',   'agent'),
  ('مدير النظام (تجريبي)', '201000000007', 'management',       'active',   'admin')
) as v(name, phone, dept, status, role)
join departments d on d.code = v.dept
on conflict do nothing;

-- ملاحظة: هؤلاء الموظفون بلا حساب دخول (auth_user_id فارغ) فلا يستطيعون استعمال الـ APIs.
-- لو عايز موظف/أدمن تجريبي يسجّل دخول فعلاً، أنشئه من الـ API (POST /api/agents مع email وpassword).
