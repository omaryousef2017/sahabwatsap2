import { db } from './db.js';
import { markRead } from './whatsapp.js';
import { qualifyLead } from './ai.js';
import { routeContact, assignContact, deptByCode, isUnavailable } from './routing.js';
import { sendAndStore } from './outbound.js';
import { tryVerifyFromInbound } from './verification.js';

// رسائل التوثيق لا تُخزَّن، فنتذكر آخر معرّفاتها كي لا تُعالج مرتين لو أعادت Meta الإرسال.
const seenVerification = new Set();
const remember = (id) => { seenVerification.add(id); if (seenVerification.size > 500) seenVerification.delete(seenVerification.values().next().value); };

function extractText(m) {
  switch (m.type) {
    case 'text': return m.text?.body ?? '';
    case 'button': return m.button?.text ?? '[زر]';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[تفاعلي]';
    case 'image': return m.image?.caption || '[صورة]';
    case 'video': return m.video?.caption || '[فيديو]';
    case 'document': return m.document?.caption || `[ملف] ${m.document?.filename ?? ''}`.trim();
    case 'audio': return '[رسالة صوتية]';
    case 'sticker': return '[ملصق]';
    case 'location': return `[موقع] ${m.location?.latitude},${m.location?.longitude}`;
    default: return `[${m.type}]`;
  }
}

async function getOrCreateContact(phone, name) {
  const found = await db.from('contacts').select('*').eq('phone', phone).maybeSingle();
  if (found.data) return found.data;
  const ins = await db.from('contacts').insert({ phone, name }).select().single();
  if (ins.error?.code === '23505') {
    // رسالتان متزامنتان من عميل جديد — الأخرى سبقتنا
    return (await db.from('contacts').select('*').eq('phone', phone).single()).data;
  }
  if (ins.error) throw ins.error;
  return ins.data;
}

export async function handleInboundMessage(m, profileName) {
  // 0) رد موظف بكود توثيق رقمه؟ يُعالج هنا ولا يُحسب عميلاً
  if (seenVerification.has(m.id)) return;
  if (m.type === 'text' && (await tryVerifyFromInbound(m.from, m.text?.body ?? ''))) return remember(m.id);

  // 1) منع التكرار (Meta تعيد الإرسال لو تأخر الرد)
  const dup = await db.from('messages').select('id').eq('wa_message_id', m.id).maybeSingle();
  if (dup.data) return;

  // 2) العميل
  const c0 = await getOrCreateContact(m.from, profileName);
  const now = new Date().toISOString();
  const patch = { last_inbound_at: now, last_message_at: now };
  if (!c0.name && profileName) patch.name = profileName;
  const { data: contact, error: cErr } = await db.from('contacts').update(patch).eq('id', c0.id).select().single();
  if (cErr) throw cErr;

  // 3) تخزين الرسالة فوراً → Realtime يشعر الداشبورد/التطبيق
  const text = extractText(m);
  const ins = await db.from('messages').insert({
    contact_id: contact.id,
    agent_id: contact.assigned_agent_id,
    department_id: contact.department_id,
    message_body: text,
    direction: 'inbound',
    sender_type: 'customer',
    wa_message_id: m.id,
    status: 'received',
    payload: m.type === 'text' ? null : (m[m.type] ?? null),
  }).select().single();
  if (ins.error?.code === '23505') return;
  if (ins.error) throw ins.error;
  markRead(m.id).catch(() => {});

  // 4) توجيه
  if (contact.ai_stage === 'new') return qualifyAndRoute(contact, ins.data, text);
  return ensureAgentAvailable(contact, ins.data);
}

// ---------- عميل جديد: ذكاء اصطناعي → قسم → Round-Robin → رد تأهيلي ----------
async function qualifyAndRoute(contact, msg, text) {
  // "حجز" ذرّي: لو وصلت رسالتان معاً، واحدة فقط تتولى التأهيل
  const claim = await db.from('contacts')
    .update({ ai_stage: 'qualifying' }).eq('id', contact.id).eq('ai_stage', 'new').select('id');
  if (!claim.data?.length) return;

  let ai, routed;
  try {
    ai = await qualifyLead({ text, name: contact.name });
    routed = await routeContact(contact.id, ai.department_code);
    await db.from('contacts').update({ ai_stage: 'routed', ai_summary: ai.summary }).eq('id', contact.id);
    await db.from('messages')
      .update({ agent_id: routed.agentId, department_id: routed.departmentId }).eq('id', msg.id);
  } catch (e) {
    await db.from('contacts').update({ ai_stage: 'new' }).eq('id', contact.id); // يُعاد المحاولة مع الرسالة التالية
    throw e;
  }

  try {
    await sendAndStore({
      contact: { ...contact, department_id: routed.departmentId },
      body: ai.reply,
      sender_type: 'ai',
      agent_id: routed.agentId,
      department_id: routed.departmentId,
    });
  } catch (e) {
    console.error('[inbound] AI reply send failed:', e.message); // التوجيه تم؛ فشل الرد لا يلغيه
  }
}

// ---------- عميل سابق: الرسالة تذهب لموظفه، ولو خرج من الخدمة يُعاد تعيينه ----------
async function ensureAgentAvailable(contact, msg) {
  if (!contact.department_id) return; // التأهيل جارٍ في طلب آخر
  let agent = null;
  if (contact.assigned_agent_id) {
    agent = (await db.from('agents').select('id,status,deleted_at,approval_status,phone_verified_at')
      .eq('id', contact.assigned_agent_id).maybeSingle()).data;
  }
  const unavailable = !agent || agent.deleted_at || agent.approval_status !== 'approved' ||
    !agent.phone_verified_at || isUnavailable(agent.status);
  if (!unavailable) return; // on_break يبقى عند موظفه ما لم يُفعَّل REROUTE_ON_BREAK

  const mgmt = await deptByCode('management');
  const r = await assignContact(contact.id, contact.department_id, mgmt?.id ?? null);
  await db.from('messages').update({ agent_id: r.agentId, department_id: r.departmentId }).eq('id', msg.id);
  // لو r.agentId = null: لا يوجد موظف متاح — تظهر المحادثة للإدارة بدون موظف.
}

// ---------- تحديثات الحالة (delivered / read / failed) ----------
export async function handleStatus(s) {
  const patch = { status: s.status };
  if (s.status === 'failed') patch.error = JSON.stringify(s.errors ?? []).slice(0, 500);
  await db.from('messages').update(patch).eq('wa_message_id', s.id);
}
