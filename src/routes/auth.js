import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ah, parse } from '../util.js';

const router = Router();

// تسجيل الدخول يتم عبر الخادم (Supabase Auth). يُفضَّل وضع SUPABASE_ANON_KEY (publishable) في .env.
async function grant(type, body) {
  const r = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=${type}`, {
    method: 'POST',
    headers: { apikey: config.supabase.anonKey || config.supabase.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
const tokens = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in });

router.post('/login', ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const { ok, j } = await grant('password', { email, password });
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  res.json(tokens(j));
}));

router.post('/refresh', ah(async (req, res) => {
  const { refresh_token } = parse(z.object({ refresh_token: z.string().min(10) }), req.body);
  const { ok, j } = await grant('refresh_token', { refresh_token });
  if (!ok) return res.status(401).json({ error: 'invalid_refresh' });
  res.json(tokens(j));
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const { data: d } = await db.from('departments').select('name_ar').eq('id', req.agent.department_id).maybeSingle();
  const { id, name, role, status } = req.agent;
  res.json({ agent: { id, name, role, status, department_name: d?.name_ar ?? null } });
}));

export default router;
