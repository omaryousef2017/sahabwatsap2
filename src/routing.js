import { db } from './db.js';
import { config } from './config.js';

// ---- كاش بسيط للأقسام (نادراً ما تتغير) ----
let deptCache = { at: 0, byCode: new Map() };
async function loadDepartments() {
  if (Date.now() - deptCache.at < 60_000 && deptCache.byCode.size) return deptCache.byCode;
  const { data, error } = await db.from('departments').select('id, code, name_ar');
  if (error) throw error;
  deptCache = { at: Date.now(), byCode: new Map(data.map((d) => [d.code, d])) };
  return deptCache.byCode;
}
export async function deptByCode(code) {
  return (await loadDepartments()).get(code) ?? null;
}

// Round-Robin: القرار كله داخل Postgres (assign_contact → pick_next_agent)
// ليكون ذرّياً حتى لو وصلت 50 رسالة جديدة في نفس اللحظة.
export async function assignContact(contactId, departmentId, fallbackId = null) {
  const { data, error } = await db.rpc('assign_contact', {
    p_contact: contactId,
    p_department: departmentId,
    p_fallback: fallbackId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { departmentId: row?.out_department_id ?? departmentId, agentId: row?.out_agent_id ?? null };
}

// عميل جديد: القسم من الذكاء الاصطناعي، والبديل الإدارة لو القسم لا يوجد به موظف active.
export async function routeContact(contactId, departmentCode) {
  const primary = (await deptByCode(departmentCode)) ?? (await deptByCode('customer_service'));
  const mgmt = await deptByCode('management');
  return assignContact(contactId, primary.id, mgmt?.id ?? null);
}

export const isUnavailable = (status) =>
  status === 'inactive' || (config.rerouteOnBreak && status === 'on_break');

// يعيد توزيع عملاء موظف خرج من الخدمة أو انتقل لقسم آخر. يرجع عدد من وجدوا موظفاً جديداً.
export async function reassignAgentContacts(agentId) {
  const { data: contacts, error } = await db
    .from('contacts').select('id, department_id').eq('assigned_agent_id', agentId);
  if (error) throw error;
  const mgmt = await deptByCode('management');
  let moved = 0;
  for (const c of contacts ?? []) {
    if (!c.department_id) continue;
    const r = await assignContact(c.id, c.department_id, mgmt?.id ?? null);
    if (r.agentId && r.agentId !== agentId) moved++;
  }
  return moved;
}
