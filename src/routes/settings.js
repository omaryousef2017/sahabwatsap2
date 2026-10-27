import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth.js';
import { ah, parse } from '../util.js';
import { current, readiness, saveSettings } from '../settings.js';

const router = Router();
router.use(requireAuth, requireAdmin); // الإدارة فقط

const schema = z.object({
  dry_run: z.boolean().optional(),
  outbound_approval: z.enum(['none', 'templates', 'all']).optional(),
  agent_approval: z.enum(['on', 'off']).optional(),
  reroute_on_break: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'empty' });

// GET /api/settings — الإعدادات الحالية + جاهزية المفاتيح (true/false فقط)
router.get('/', ah(async (_req, res) => {
  res.json({ settings: current(), readiness: readiness() });
}));

// PUT /api/settings — تغيير وتطبيق فوري (والتفعيل "الفعلي" مرفوض لو توكن Meta أو Phone number ID ناقص)
router.put('/', ah(async (req, res) => {
  const patch = parse(schema, req.body);
  const settings = await saveSettings(patch, req.agent.id);
  res.json({ settings, readiness: readiness() });
}));

export default router;
