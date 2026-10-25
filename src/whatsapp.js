import { config } from './config.js';

const base = () =>
  `https://graph.facebook.com/${config.meta.apiVersion}/${config.meta.phoneNumberId}/messages`;

async function call(payload) {
  if (config.dryRun) {
    console.log('[DRY_RUN → Meta]', JSON.stringify(payload));
    return { messages: [{ id: `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }] };
  }
  const res = await fetch(base(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.meta.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Meta API ${res.status}`);
    err.meta = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function sendText(to, body) {
  const d = await call({ recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } });
  return d.messages[0].id;
}

// قالب معتمد من Meta — مطلوب لبدء محادثة أو الرد بعد مرور 24 ساعة على آخر رسالة من العميل.
export async function sendTemplate(to, { name, language = 'ar', components }) {
  const d = await call({
    to,
    type: 'template',
    template: { name, language: { code: language }, ...(components ? { components } : {}) },
  });
  return d.messages[0].id;
}

export async function markRead(waMessageId) {
  await call({ status: 'read', message_id: waMessageId });
}
