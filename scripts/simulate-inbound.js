// يحاكي رسائل واردة من Meta (موقّعة بنفس طريقة Meta) لتجربة التوزيع بدون واتساب حقيقي.
//   node scripts/simulate-inbound.js 6 "عايز شقة 3 غرف في التجمع"
// شغّل الخادم قبلها بـ DRY_RUN=true كي لا يُرسل لأي رقم فعلي.
import 'dotenv/config';
import crypto from 'node:crypto';

const count = Number(process.argv[2] || 3);
const text = process.argv[3] || 'عايز اعرف اسعار الشقق المتاحة';
const url = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}/webhook`;
const secret = process.env.META_APP_SECRET;
if (!secret) throw new Error('META_APP_SECRET missing');

for (let i = 1; i <= count; i++) {
  const from = `2010999${String(Date.now()).slice(-5)}${i}`.slice(0, 12);
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      contacts: [{ profile: { name: `عميل تجريبي ${i}` }, wa_id: from }],
      messages: [{ from, id: `wamid.SIM${Date.now()}${i}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
  console.log(`#${i} from ${from} → HTTP ${r.status}`);
  await new Promise((ok) => setTimeout(ok, 400));
}
console.log('\nافحص التوزيع في Supabase:\n' +
  "select a.name, count(*) from contacts c join agents a on a.id=c.assigned_agent_id group by a.name order by 2 desc;");
