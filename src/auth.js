import { db } from './db.js';

// يتوقع: Authorization: Bearer <Supabase access_token> من تسجيل دخول الموظف في التطبيق/الداشبورد.
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'invalid_token' });

    const { data: agent } = await db
      .from('agents')
      .select('id, name, role, status, department_id, deleted_at, approval_status')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    if (!agent || agent.deleted_at || agent.status === 'inactive') {
      return res.status(403).json({ error: 'account_disabled' }); // الإيقاف يقطع الوصول فوراً
    }
    if (agent.approval_status !== 'approved') {
      return res.status(403).json({ error: 'pending_approval' }); // موظف جديد لم تعتمده الإدارة بعد
    }
    req.agent = agent;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req, res, next) {
  if (req.agent?.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
}
