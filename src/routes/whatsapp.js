import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { ah, parse } from '../util.js';
import { sendAndStore } from '../outbound.js';

const router = Router();

const sendSchema = z.object({
  contact_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4096).optional(),
  template: z.object({
    name: z.string().min(1),
    language: z.string().default('ar'),
    components: z.array(z.any()).optional(),
  }).optional(),
}).refine((d) => d.body || d.template, { message: 'body_or_template_required' });

// سياسة الموافقة: الإدارة لا تحتاج موافقة؛ الموظف حسب OUTBOUND_APPROVAL (none | templates | all)
const needsApprovalFor = (agent, template) =>
  agent.role !== 'admin' &&
  (config.outboundApproval === 'all' || (config.outboundApproval === 'templates' && !!template));

// POST /api/whatsapp/send — الموظف/الإدارة → العميل (يصل باسم ورقم الشركة)
router.post('/send', requireAuth, ah(async (req, res) => {
  const { contact_id, body, template } = parse(sendSchema, req.body);

  const { data: contact } = await db.from('contacts').select('*').eq('id', contact_id).maybeSingle();
  if (!contact) return res.status(404).json({ error: 'contact_not_found' });

  const isAdmin = req.agent.role === 'admin';
  if (!isAdmin && contact.assigned_agent_id !== req.agent.id) {
    return res.status(403).json({ error: 'not_your_contact' });
  }

  // سياسة واتساب: النص الحر مسموح فقط خلال 24 ساعة من آخر رسالة من العميل.
  if (!template) {
    const last = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      return res.status(409).json({
        error: 'outside_24h_window',
        hint: 'أرسل قالب (template) معتمداً من Meta بدل نص حر.',
      });
    }
  }

  const needsApproval = needsApprovalFor(req.agent, template);
  try {
    const message = await sendAndStore({
      contact, body, template,
      sender_type: 'agent',
      agent_id: req.agent.id,
      department_id: contact.department_id,
      needsApproval,
    });
    // 202 = مقبولة وتنتظر اعتماد الإدارة؛ 201 = أُرسلت
    res.status(needsApproval ? 202 : 201).json({ message, approval_required: needsApproval });
  } catch (e) {
    if (e.status === 409) throw e;
    e.status = 502; // فشل من جهة Meta — الرسالة محفوظة بحالة failed
    e.expose = true;
    e.message = 'whatsapp_send_failed';
    throw e;
  }
}));

export default router;
