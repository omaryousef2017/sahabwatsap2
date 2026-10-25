import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { ah, parse } from '../util.js';
import { deliverStored } from '../outbound.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const uuid = z.string().uuid();
const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// GET /api/approvals/outbound?status=pending — رسائل الشركة بانتظار الاعتماد
router.get('/outbound', ah(async (req, res) => {
  const q = parse(listQuery, req.query);
  const { data: approvals, error } = await db.from('outbound_approvals').select('*')
    .eq('status', q.status).order('created_at', { ascending: true }).limit(q.limit);
  if (error) throw error;

  const msgIds = approvals.map((a) => a.message_id);
  const { data: msgs } = msgIds.length
    ? await db.from('messages').select('id, contact_id, message_body, payload, department_id').in('id', msgIds)
    : { data: [] };
  const contactIds = [...new Set((msgs ?? []).map((m) => m.contact_id))];
  const agentIds = [...new Set(approvals.map((a) => a.requested_by).filter(Boolean))];
  const [{ data: contacts }, { data: agents }] = await Promise.all([
    contactIds.length ? db.from('contacts').select('id, name, phone').in('id', contactIds) : { data: [] },
    agentIds.length ? db.from('agents').select('id, name').in('id', agentIds) : { data: [] },
  ]);
  const M = new Map((msgs ?? []).map((m) => [m.id, m]));
  const C = new Map((contacts ?? []).map((c) => [c.id, c]));
  const A = new Map((agents ?? []).map((a) => [a.id, a.name]));

  res.json({
    approvals: approvals.map((a) => {
      const m = M.get(a.message_id);
      return { ...a, message: m ?? null, contact: m ? C.get(m.contact_id) ?? null : null, requested_by_name: A.get(a.requested_by) ?? null };
    }),
  });
}));

// POST /api/approvals/outbound/:id/approve — اعتماد ثم إرسال فعلي
router.post('/outbound/:id/approve', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  // "حجز" ذرّي: لو ضغط أدمنان معاً يرسل واحد فقط
  const { data: appr } = await db.from('outbound_approvals')
    .update({ status: 'approved', reviewed_by: req.agent.id, reviewed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending').select().maybeSingle();
  if (!appr) return res.status(409).json({ error: 'not_found_or_already_reviewed' });

  try {
    const message = await deliverStored(appr.message_id);
    res.json({ approval: appr, message });
  } catch (e) {
    if (e.status === 409) throw e;
    e.status = 502; e.expose = true; e.message = 'whatsapp_send_failed';
    throw e;
  }
}));

// POST /api/approvals/outbound/:id/reject {reason?}
router.post('/outbound/:id/reject', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body ?? {});
  const { data: appr } = await db.from('outbound_approvals')
    .update({ status: 'rejected', reviewed_by: req.agent.id, reviewed_at: new Date().toISOString(), reject_reason: reason ?? null })
    .eq('id', id).eq('status', 'pending').select().maybeSingle();
  if (!appr) return res.status(409).json({ error: 'not_found_or_already_reviewed' });

  await db.from('messages').update({ status: 'rejected', error: reason ?? 'rejected_by_admin' }).eq('id', appr.message_id);
  res.json({ approval: appr });
}));

export default router;
