import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { ah, parse } from '../util.js';

const router = Router();
router.use(requireAuth);

const listQuery = z.object({
  department_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  unassigned: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

async function decorate(rows) {
  // أسماء الموظفين والأقسام للعرض
  const [{ data: agents }, { data: deps }] = await Promise.all([
    db.from('agents').select('id, name'),
    db.from('departments').select('id, name_ar'),
  ]);
  const a = new Map((agents ?? []).map((x) => [x.id, x.name]));
  const d = new Map((deps ?? []).map((x) => [x.id, x.name_ar]));
  return rows.map((r) => ({ ...r, agent_name: a.get(r.assigned_agent_id) ?? null, department_name: d.get(r.department_id) ?? null }));
}

// GET /api/conversations/admin — كل المحادثات (للإدارة فقط)
router.get('/admin', requireAdmin, ah(async (req, res) => {
  const q = parse(listQuery, req.query);
  let query = db.from('conversation_summaries').select('*', { count: 'exact' })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (q.department_id) query = query.eq('department_id', q.department_id);
  if (q.agent_id) query = query.eq('assigned_agent_id', q.agent_id);
  if (q.unassigned === 'true') query = query.is('assigned_agent_id', null);
  if (q.search) {
    const s = q.search.replace(/[,()%]/g, ' ');
    query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  res.json({ total: count, conversations: await decorate(data) });
}));

// GET /api/conversations/agent/:agent_id — محادثات الموظف فقط (للأندرويد)
router.get('/agent/:agent_id', ah(async (req, res) => {
  const { agent_id } = req.params;
  if (!z.string().uuid().safeParse(agent_id).success) return res.status(400).json({ error: 'bad_agent_id' });
  if (req.agent.role !== 'admin' && req.agent.id !== agent_id) {
    return res.status(403).json({ error: 'not_your_conversations' });
  }
  const q = parse(listQuery, req.query);
  const { data, error, count } = await db.from('conversation_summaries').select('*', { count: 'exact' })
    .eq('assigned_agent_id', agent_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) throw error;
  res.json({ total: count, conversations: await decorate(data) });
}));

// GET /api/conversations/:contact_id/messages — رسائل محادثة (الإدارة: أي محادثة، الموظف: محادثاته)
router.get('/:contact_id/messages', ah(async (req, res) => {
  const { contact_id } = req.params;
  if (!z.string().uuid().safeParse(contact_id).success) return res.status(400).json({ error: 'bad_contact_id' });

  const { data: contact } = await db.from('contacts').select('*').eq('id', contact_id).maybeSingle();
  if (!contact) return res.status(404).json({ error: 'contact_not_found' });
  if (req.agent.role !== 'admin' && contact.assigned_agent_id !== req.agent.id) {
    return res.status(403).json({ error: 'not_your_contact' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let query = db.from('messages').select('*').eq('contact_id', contact_id)
    .order('timestamp', { ascending: false }).limit(limit);
  if (req.query.before) query = query.lt('timestamp', String(req.query.before));
  const { data, error } = await query;
  if (error) throw error;
  res.json({ contact, messages: data.reverse() }); // من الأقدم للأحدث للعرض
}));

export default router;
