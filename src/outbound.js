import { db } from './db.js';
import { sendText, sendTemplate } from './whatsapp.js';

const DAY = 24 * 3600 * 1000;

// يسجل الرسالة أولاً ثم: إما يضعها في طابور موافقة الإدارة، أو يرسلها لـ Meta فوراً.
// أي تغيير في الجدول يصل للتطبيق والداشبورد لحظياً عبر Realtime.
export async function sendAndStore({ contact, body, template, sender_type, agent_id, department_id, needsApproval = false }) {
  const { data: row, error } = await db
    .from('messages')
    .insert({
      contact_id: contact.id,
      agent_id: agent_id ?? null,
      department_id: department_id ?? contact.department_id ?? null,
      message_body: body ?? `[قالب] ${template.name}`,
      direction: 'outbound',
      sender_type,
      status: needsApproval ? 'pending_approval' : 'pending',
      payload: template ? { template } : null,   // يُحفظ ليُرسل لاحقاً بعد الموافقة
    })
    .select()
    .single();
  if (error) throw error;

  if (needsApproval) {
    const { error: aErr } = await db.from('outbound_approvals').insert({ message_id: row.id, requested_by: agent_id });
    if (aErr) {
      await db.from('messages').delete().eq('id', row.id); // لا نترك رسالة معلّقة بلا طلب موافقة
      throw aErr;
    }
    return row;
  }
  return deliverStored(row.id);
}

// يرسل رسالة محفوظة لـ Meta ويحدّث حالتها. يُستخدم أيضاً عند اعتماد الإدارة.
export async function deliverStored(messageId) {
  const { data: msg } = await db.from('messages').select('*').eq('id', messageId).single();
  const { data: contact } = await db.from('contacts').select('*').eq('id', msg.contact_id).single();
  const template = msg.payload?.template;

  // نافذة الـ 24 ساعة قد تنتهي أثناء انتظار الموافقة.
  if (!template) {
    const last = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : 0;
    if (Date.now() - last > DAY && msg.sender_type !== 'ai') {
      await db.from('messages').update({ status: 'failed', error: 'outside_24h_window' }).eq('id', msg.id);
      const e = new Error('outside_24h_window');
      e.status = 409;
      throw e;
    }
  }

  try {
    const waId = template ? await sendTemplate(contact.phone, template) : await sendText(contact.phone, msg.message_body);
    const { data } = await db.from('messages').update({ wa_message_id: waId, status: 'sent' }).eq('id', msg.id).select().single();
    await db.from('contacts').update({ last_message_at: new Date().toISOString() }).eq('id', contact.id);
    return data;
  } catch (e) {
    await db.from('messages').update({ status: 'failed', error: String(e.message).slice(0, 500) }).eq('id', msg.id);
    throw e;
  }
}
