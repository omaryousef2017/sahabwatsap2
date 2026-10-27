import { config } from './config.js';
import { db } from './db.js';

// إعدادات قابلة للتغيير من لوحة الإدارة بدون إعادة تشغيل. الأسرار (التوكنات) تبقى في Render فقط.
const KEY = 'runtime';

export const isPlaceholder = (v) => !v || /^PASTE_|_HERE$|^pending$/i.test(String(v).trim());

// حالة جاهزية المفاتيح (true/false فقط — لا تُرجع قيمها أبداً)
export function readiness() {
  return {
    meta_token: !isPlaceholder(config.meta.token),
    phone_number_id: !isPlaceholder(config.meta.phoneNumberId),
    app_secret: !isPlaceholder(config.meta.appSecret),
    ai_key: !isPlaceholder(config.ai.apiKey),
  };
}

export const canGoLive = () => {
  const r = readiness();
  return r.meta_token && r.phone_number_id;
};

export const current = () => ({
  dry_run: config.dryRun,
  outbound_approval: config.outboundApproval,
  agent_approval: config.agentApproval,
  reroute_on_break: config.rerouteOnBreak,
});

function apply(s) {
  if (typeof s.dry_run === 'boolean') config.dryRun = s.dry_run;
  if (['none', 'templates', 'all'].includes(s.outbound_approval)) config.outboundApproval = s.outbound_approval;
  if (['on', 'off'].includes(s.agent_approval)) config.agentApproval = s.agent_approval;
  if (typeof s.reroute_on_break === 'boolean') config.rerouteOnBreak = s.reroute_on_break;
}

// عند التشغيل: ما حُفظ من اللوحة يتقدّم على متغيرات Render. لو محفوظ "فعلي" والمفاتيح ناقصة نبقى تجريبي.
export async function loadSettings() {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    if (error) return console.warn('[settings] الجدول غير متاح، نستخدم متغيرات البيئة:', error.message);
    if (!data?.value) return;
    const s = { ...data.value };
    if (s.dry_run === false && !canGoLive()) {
      console.warn('[settings] محفوظ وضع "فعلي" لكن META_ACCESS_TOKEN أو META_PHONE_NUMBER_ID ناقص — نبقى في الوضع التجريبي');
      s.dry_run = true;
    }
    apply(s);
    console.log('[settings] تم تحميل إعدادات اللوحة');
  } catch (e) {
    console.warn('[settings] تعذّر التحميل:', e.message);
  }
}

function fail(message, status) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

export async function saveSettings(patch, agentId) {
  const next = { ...current(), ...patch };
  if (next.dry_run === false && !canGoLive()) throw fail('meta_credentials_missing', 400);
  const { error } = await db.from('app_settings').upsert({
    key: KEY, value: next, updated_by: agentId ?? null, updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[settings] save failed:', error.message);
    throw fail(error.code === '42P01' || /app_settings/.test(error.message || '') ? 'settings_table_missing' : 'settings_save_failed', 500);
  }
  apply(next);
  console.log(`[settings] updated by ${agentId}: dry_run=${next.dry_run} outbound=${next.outbound_approval} agent=${next.agent_approval} reroute=${next.reroute_on_break}`);
  return next;
}
