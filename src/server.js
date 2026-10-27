import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { errorHandler } from './util.js';
import webhook from './routes/webhook.js';
import whatsapp from './routes/whatsapp.js';
import conversations from './routes/conversations.js';
import agents from './routes/agents.js';
import approvals from './routes/approvals.js';
import authRoutes from './routes/auth.js';
import meta from './routes/meta.js';
import settingsRoutes from './routes/settings.js';
import { loadSettings } from './settings.js';

const app = express();
app.set('trust proxy', 1); // خلف Nginx
// الصفحة الرئيسية فيها سكربت وستايل داخليين، فنسمح بهم فقط في هذه الصفحة
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'none'"],
      'upgrade-insecure-requests': null, // يسمح بالتشغيل على http (محلي/سيرفر داخلي)
    },
  },
}));
app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : {}));

// نحتفظ بالجسم الخام للتحقق من توقيع Meta
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.use('/webhook', webhook);                       // بدون rate limit: Meta فقط
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/whatsapp', whatsapp);
app.use('/api/conversations', conversations);
app.use('/api/agents', agents);
app.use('/api/approvals', approvals);
app.use('/api/settings', settingsRoutes);
app.use('/api', meta);

// فحص قاعدة البيانات بمهلة 8 ثواني: بدل ما يعلّق، يقول السبب
async function checkDb() {
  const t0 = Date.now();
  let error = null;
  try {
    const r = await Promise.race([
      db.from('departments').select('id').limit(1),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 8s: Supabase لا يرد (راجع SUPABASE_URL أو الشبكة)')), 8000)),
    ]);
    error = r.error;
  } catch (e) {
    error = e;
  }
  const reason = error ? (error.message || error.code || String(error)) : null;
  return { ok: !error, reason, latency_ms: Date.now() - t0 };
}

app.get('/health', async (_req, res) => {
  const r = await checkDb();
  if (!r.ok) console.error('[health] db error:', r.reason);
  res.status(r.ok ? 200 : 503).json({
    ok: r.ok, db: r.ok, dry_run: config.dryRun, latency_ms: r.latency_ms, time: new Date().toISOString(),
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(here, '..', 'public')));

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use(errorHandler);

// نحمّل إعدادات اللوحة (بمهلة 8 ثواني) قبل استقبال أي رسالة
await Promise.race([loadSettings(), new Promise((r) => setTimeout(r, 8000))]);

app.listen(config.port, async () => {
  console.log(`SAHAB WhatsApp engine on :${config.port}${config.dryRun ? '  [DRY_RUN]' : ''}`);
  const r = await checkDb();
  console.log(r.ok ? `✔ Supabase connected (${r.latency_ms}ms)` : `✖ Supabase problem: ${r.reason}`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
