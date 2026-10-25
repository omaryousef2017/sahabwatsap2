import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const e = process.env;
const email = (e.ADMIN_EMAIL || '').trim();
const password = e.ADMIN_PASSWORD || '';
const name = e.ADMIN_NAME || 'Sahab Admin';
const phone = (() => {
  let d = String(e.ADMIN_PHONE || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = '20' + d.slice(1);
  return d;
})();
const fail = (m) => { console.error('✖ ' + m); process.exit(1); };
if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ناقصين في .env');
if (!email || password.length < 8 || !phone) fail('املأ ADMIN_EMAIL و ADMIN_PASSWORD (8 أحرف أو أكثر) و ADMIN_PHONE في .env');

const db = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let user = null;
for (let page = 1; page < 20 && !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail('تعذّر قراءة المستخدمين: ' + error.message);
  user = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
  if (data.users.length < 200) break;
}
if (user) {
  const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (error) fail('تعذّر تحديث الباسورد: ' + error.message);
  console.log('✔ تم ضبط الباسورد وتأكيد الإيميل:', email);
} else {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) fail('تعذّر إنشاء المستخدم: ' + error.message);
  user = data.user;
  console.log('✔ تم إنشاء المستخدم:', email);
}

const dep = await db.from('departments').select('id').eq('code', 'management').maybeSingle();
if (dep.error || !dep.data) fail('جدول الأقسام غير موجود. شغّل أولاً: npm run setup:db  (أو sql/00_ALL_IN_ONE.sql بدور postgres)');

const row = { name, phone, department_id: dep.data.id, role: 'admin', status: 'active', approval_status: 'approved', phone_verified_at: new Date().toISOString(), deleted_at: null };
const ex = await db.from('agents').select('id').eq('auth_user_id', user.id).maybeSingle();
const w = ex.data
  ? await db.from('agents').update(row).eq('id', ex.data.id)
  : await db.from('agents').insert({ ...row, auth_user_id: user.id });
if (w.error) fail('تعذّر حفظ الأدمن: ' + w.error.message);
console.log('✔ الأدمن جاهز في جدول agents');

const r = await fetch(`${e.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: e.SUPABASE_ANON_KEY || e.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!r.ok) fail('الدخول لا يزال مرفوضاً. تأكد من SUPABASE_ANON_KEY (المفتاح العام) في .env');
console.log('✔ اختبار الدخول نجح. افتح http://localhost:' + (e.PORT || 3000) + ' وادخل بنفس الإيميل والباسورد');
