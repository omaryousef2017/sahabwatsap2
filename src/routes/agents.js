import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { ah, parse } from '../util.js';
import { normalizePhone } from '../phone.js';
import { reassignAgentContacts, isUnavailable } from '../routing.js';
import { issueVerification } from '../verification.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// أعمدة آمنة للإرجاع (بدون verify_code_hash)
const COLS = 'id, auth_user_id, name, phone, department_id, status, role, approval_status, approved_at, phone_verified_at, last_assigned_at, created_at, updated_at';

const status = z.enum(['active', 'inactive', 'on_break']);
const role = z.enum(['agent', 'admin']);
const phone = z.string().min(8).max(20).transform(normalizePhone);
const uuid = z.string().uuid();

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone,
  department_id: uuid,
  role: role.default('agent'),
  status: status.default('active'),
  email: z.string().email().optional(),       // لو أُرسل مع password يُنشأ حساب دخول للتطبيق
  password: z.string().min(8).optional(),
}).refine((d) => !!d.email === !!d.password, { message: 'email_and_password_together' });

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone,
  department_id: uuid,
  role,
  status,
  password: z.string().min(8),                // إعادة تعيين كلمة المرور
}).partial();

const otherActiveAdmins = async (excludeId) => {
  const { count } = await db.from('agents').select('id', { count: 'exact', head: true })
    .eq('role', 'admin').neq('status', 'inactive').eq('approval_status', 'approved')
    .is('deleted_at', null).neq('id', excludeId);
  return count ?? 0;
};

// موظف يستقبل عملاء فعلياً = active + معتمد + رقمه موثّق
const eligible = (a) => a.status === 'active' && a.approval_status === 'approved' && !!a.phone_verified_at;

// GET /api/agents — قائمة الموظفين (?department_id ؛ ?approval_status=pending)
router.get('/', ah(async (req, res) => {
  let q = db.from('agents').select(`${COLS}, department:departments(id, code, name_ar)`)
    .is('deleted_at', null).order('created_at');
  if (req.query.department_id) q = q.eq('department_id', String(req.query.department_id));
  if (req.query.approval_status) q = q.eq('approval_status', String(req.query.approval_status));
  const { data, error } = await q;
  if (error) throw error;
  res.json({ agents: data.map((a) => ({ ...a, eligible_for_routing: eligible(a) })) });
}));

// POST /api/agents — ضم موظف: يُنشأ "بانتظار الموافقة" + يُرسل كود توثيق لواتساب الموظف
router.post('/', ah(async (req, res) => {
  const b = parse(createSchema, req.body);
  let authUserId = null;

  if (b.email) {
    const { data, error } = await db.auth.admin.createUser({ email: b.email, password: b.password, email_confirm: true });
    if (error) return res.status(400).json({ error: 'auth_create_failed', message: error.message });
    authUserId = data.user.id;
  }

  const approval = config.agentApproval === 'on' ? 'pending' : 'approved';
  const { data, error } = await db.from('agents').insert({
    name: b.name, phone: b.phone, department_id: b.department_id,
    role: b.role, status: b.status, auth_user_id: authUserId,
    approval_status: approval, created_by: req.agent.id,
    ...(approval === 'approved' ? { approved_by: req.agent.id, approved_at: new Date().toISOString() } : {}),
  }).select(COLS).single();

  if (error) {
    if (authUserId) await db.auth.admin.deleteUser(authUserId).catch(() => {}); // تراجع
    if (error.code === '23505') return res.status(409).json({ error: 'phone_already_exists' });
    if (error.code === '23503') return res.status(400).json({ error: 'department_not_found' });
    throw error;
  }

  const verification = await issueVerification(data);
  res.status(201).json({
    agent: { ...data, eligible_for_routing: false },
    verification,
    next: [
      ...(approval === 'pending' ? ['approve: POST /api/agents/:id/approve (من أدمن آخر لو متاح)'] : []),
      'verify: الموظف يرد بالكود على رقم الشركة في واتساب',
    ],
  });
}));

// POST /api/agents/:id/send-verification — إعادة إرسال كود التوثيق
router.post('/:id/send-verification', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { data: a } = await db.from('agents').select('id, phone, phone_verified_at').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!a) return res.status(404).json({ error: 'agent_not_found' });
  if (a.phone_verified_at) return res.status(409).json({ error: 'already_verified' });
  res.json({ verification: await issueVerification(a) });
}));

// POST /api/agents/:id/approve — اعتماد الشركة للموظف
router.post('/:id/approve', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { data: a } = await db.from('agents').select(COLS + ', created_by').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!a) return res.status(404).json({ error: 'agent_not_found' });
  if (a.approval_status !== 'pending') return res.status(409).json({ error: 'not_pending' });

  // مبدأ "عينين": من أضاف الموظف لا يعتمده بنفسه إلا لو هو الأدمن الوحيد.
  if (a.created_by === req.agent.id && (await otherActiveAdmins(req.agent.id)) > 0) {
    return res.status(403).json({ error: 'needs_different_admin' });
  }

  const { data, error } = await db.from('agents')
    .update({ approval_status: 'approved', approved_by: req.agent.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('approval_status', 'pending').select(COLS).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(409).json({ error: 'not_pending' });
  res.json({
    agent: { ...data, eligible_for_routing: eligible(data) },
    note: data.phone_verified_at ? null : 'لن يستقبل عملاء قبل توثيق رقمه بالكود',
  });
}));

// POST /api/agents/:id/reject — رفض الانضمام
router.post('/:id/reject', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { data, error } = await db.from('agents')
    .update({ approval_status: 'rejected', status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', id).eq('approval_status', 'pending').is('deleted_at', null).select(COLS).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(409).json({ error: 'not_pending_or_not_found' });
  res.json({ agent: data });
}));

// PUT /api/agents/:id — تعديل / نقل قسم / تغيير حالة
router.put('/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const patch = parse(updateSchema, req.body);

  const { data: before } = await db.from('agents').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!before) return res.status(404).json({ error: 'agent_not_found' });

  const next = { ...before, ...patch };
  const losingAdmin = before.role === 'admin' && before.status !== 'inactive' &&
    (next.role !== 'admin' || next.status === 'inactive');
  if (losingAdmin && (await otherActiveAdmins(id)) === 0) {
    return res.status(409).json({ error: 'cannot_remove_last_admin' });
  }

  const { password, ...columns } = patch;
  if (password) {
    if (!before.auth_user_id) return res.status(400).json({ error: 'agent_has_no_login' });
    const { error } = await db.auth.admin.updateUserById(before.auth_user_id, { password });
    if (error) return res.status(400).json({ error: 'password_update_failed', message: error.message });
  }

  // رقم جديد = واتساب جديد → يلزم توثيقه من جديد ويخرج من الدورة حتى ذلك الحين
  const phoneChanged = patch.phone && patch.phone !== before.phone;
  const update = { ...columns, updated_at: new Date().toISOString(),
    ...(phoneChanged ? { phone_verified_at: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0 } : {}) };

  const { data, error } = await db.from('agents').update(update).eq('id', id).select(COLS).single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'phone_already_exists' });
    if (error.code === '23503') return res.status(400).json({ error: 'department_not_found' });
    throw error;
  }

  const verification = phoneChanged ? await issueVerification(data) : undefined;

  // خروج من الخدمة / نقل قسم / تغيير رقم → عملاؤه الحاليون يُعاد توزيعهم
  const leftPool = (!isUnavailable(before.status) && isUnavailable(next.status)) ||
    (patch.department_id && patch.department_id !== before.department_id) || phoneChanged;
  const reassigned = leftPool ? await reassignAgentContacts(id) : 0;

  res.json({ agent: { ...data, eligible_for_routing: eligible(data) }, reassigned_contacts: reassigned, ...(verification ? { verification } : {}) });
}));

// DELETE /api/agents/:id — إلغاء تفعيل نهائي (soft delete): يتوقف عن استقبال العملاء فوراً
router.delete('/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { data: before } = await db.from('agents').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!before) return res.status(404).json({ error: 'agent_not_found' });

  if (before.role === 'admin' && before.status !== 'inactive' && (await otherActiveAdmins(id)) === 0) {
    return res.status(409).json({ error: 'cannot_remove_last_admin' });
  }

  const { error } = await db.from('agents')
    .update({ status: 'inactive', deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              verify_code_hash: null, verify_expires_at: null })
    .eq('id', id);
  if (error) throw error;

  const reassigned = await reassignAgentContacts(id);
  if (before.auth_user_id) {
    await db.auth.admin.updateUserById(before.auth_user_id, { ban_duration: '876000h' }).catch(() => {});
  }
  res.json({ ok: true, reassigned_contacts: reassigned });
}));

export default router;
