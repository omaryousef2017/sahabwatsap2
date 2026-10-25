import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { handleInboundMessage, handleStatus } from '../inbound.js';

const router = Router();

// ---- GET: تحقق Meta من الـ Webhook (مرة عند الإعداد) ----
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === config.meta.verifyToken) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// ---- التحقق من توقيع X-Hub-Signature-256 (يمنع أي طرف من انتحال Meta) ----
function validSignature(req) {
  const sig = req.get('x-hub-signature-256') || '';
  if (!req.rawBody || !sig.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.meta.appSecret).update(req.rawBody).digest('hex');
  const given = sig.slice(7);
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// ---- POST: الرسائل الواردة ----
router.post('/', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // نرد فوراً (Meta تنتظر ثوانٍ فقط) ونعالج في الخلفية
  processPayload(req.body).catch((e) => console.error('[webhook] processing failed:', e));
});

async function processPayload(body) {
  if (body?.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        try { await handleInboundMessage(m, names.get(m.from)); }
        catch (e) { console.error('[webhook] message', m.id, e); }
      }
      for (const s of v.statuses ?? []) {
        try { await handleStatus(s); } catch (e) { console.error('[webhook] status', s.id, e); }
      }
    }
  }
}

export default router;
