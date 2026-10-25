import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ah } from '../util.js';

const router = Router();

// GET /api/departments — لقوائم الاختيار في التطبيق/الداشبورد
router.get('/departments', requireAuth, ah(async (_req, res) => {
  const { data, error } = await db.from('departments').select('id, code, name_ar').order('created_at');
  if (error) throw error;
  res.json({ departments: data });
}));

export default router;
