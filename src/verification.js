import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { sendTemplate, sendText } from './whatsapp.js';

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const toLatinDigits = (s) =>
  String(s)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

export const genCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// HMAC مرتبط بالموظف: لا نخزن الكود نفسه، ولا يصلح كود موظف لموظف آخر.
export const hashCode = (agentId, code) =>
  crypto.createHmac('sha256', config.meta.appSecret).update(`${agentId}:${code}`).digest('hex');

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// يرسل كود التوثيق لواتساب الموظف من رقم الشركة (قالب Authentication معتمد من Meta).
// الموظف يرد بالكود على نفس الرقم → ثبت أنه يملك الرقم فعلاً.
export async function issueVerification(agent) {
  const code = genCode();
  await db.from('agents').update({
    verify_code_hash: hashCode(agent.id, code),
    verify_expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    verify_attempts: 0,
  }).eq('id', agent.id);

  const dev = config.dryRun ? { dev_code: code } : {}; // الكود لا يخرج من الخادم إلا في DRY_RUN
  try {
    await sendTemplate(agent.phone, {
      name: config.verifyTemplate,
      language: 'ar',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    });
    return { sent: true, expires_in_minutes: TTL_MS / 60000, ...dev };
  } catch (e) {
    return { sent: false, error: e.message, ...dev };
  }
}

// يُستدعى من الـ webhook قبل أي معالجة: لو المرسل موظف ينتظر التوثيق فالرسالة له وليست عميلاً.
export async function tryVerifyFromInbound(phone, text) {
  const { data: agent } = await db.from('agents')
    .select('id, verify_code_hash, verify_expires_at, verify_attempts')
    .eq('phone', phone).is('deleted_at', null).is('phone_verified_at', null)
    .not('verify_code_hash', 'is', null).maybeSingle();
  if (!agent) return false;

  const reply = (t) => sendText(phone, t).catch(() => {});

  if (agent.verify_attempts >= MAX_ATTEMPTS) {
    await reply('تجاوزت عدد المحاولات المسموحة. اطلب من الإدارة إرسال كود جديد.');
    return true;
  }
  if (!agent.verify_expires_at || new Date(agent.verify_expires_at) < new Date()) {
    await reply('انتهت صلاحية الكود. اطلب من الإدارة إرسال كود جديد.');
    return true;
  }

  const m = toLatinDigits(text).match(/\b(\d{6})\b/);
  if (!m || !safeEqual(hashCode(agent.id, m[1]), agent.verify_code_hash)) {
    await db.from('agents').update({ verify_attempts: agent.verify_attempts + 1 }).eq('id', agent.id);
    await reply('الكود غير صحيح. أرسل الكود المكوّن من 6 أرقام كما وصلك.');
    return true;
  }

  await db.from('agents').update({
    phone_verified_at: new Date().toISOString(),
    verify_code_hash: null, verify_expires_at: null, verify_attempts: 0,
  }).eq('id', agent.id);
  await reply('تم توثيق رقمك بنجاح ✅ سيتم تفعيلك بعد اعتماد الإدارة.');
  return true;
}
