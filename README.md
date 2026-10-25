# سحاب العقارية (SAHAB) — محرك واتساب (Node.js + Supabase)

رقم الشركة الموحّد (Meta Cloud API) → استقبال → تأهيل بالذكاء الاصطناعي → توزيع Round-Robin على الأقسام → تخزين في Supabase → إشعار لحظي للأندرويد والداشبورد.
**للتشغيل خطوة بخطوة على ويندوز: `START_HERE_AR.md`.**

```
العميل ──► Meta ──► POST /webhook ──► [تحقق توقيع] ──► messages (Supabase) ──► Realtime ──► Android / CRM
                                          │
                 عميل جديد: AI يحدد القسم + يرد ──► assign_contact() (Round-Robin داخل Postgres)
                 عميل سابق: يذهب لموظفه (ولو موقوف يُعاد تعيينه)

الموظف ──► POST /api/whatsapp/send ──► [موافقة الإدارة حسب السياسة] ──► Meta ──► العميل (باسم ورقم الشركة)
```

## الملفات
| المسار | الوظيفة |
|---|---|
| `sql/00_ALL_IN_ONE.sql` | كل الجداول والدوال (Round-Robin) والـ RLS والـ Realtime — ملف واحد، آمن لإعادة التشغيل |
| `scripts/bootstrap-admin.js` | إنشاء أول أدمن (npm run setup:admin) |
| `sql/03_seed_demo.sql` | بيانات تجريبية (اختياري) |
| `src/server.js` | الخادم + فحص `/health` |
| `src/routes/webhook.js` | تحقق Meta + التوقيع + استقبال الرسائل |
| `src/inbound.js` · `ai.js` · `routing.js` | معالجة الوارد، التأهيل، التوزيع |
| `src/outbound.js` · `whatsapp.js` | الإرسال لـ Meta وطابور الموافقة |
| `src/verification.js` | توثيق واتساب الموظف بكود |
| `src/routes/*.js` | الـ APIs (المحادثات، الموظفون، الموافقات، الإرسال) |
| `public/index.html` | صفحة حالة بهوية الأولى |
| `scripts/simulate-inbound.js` | محاكاة رسائل واردة موقّعة |

## الـ APIs (Header: `Authorization: Bearer <Supabase access_token>`)
| Method | Path | من يستخدمه |
|---|---|---|
| POST | `/api/whatsapp/send` `{contact_id, body}` أو `{contact_id, template:{name,language}}` | موظف (عملاؤه فقط) / إدارة |
| GET | `/api/conversations/admin?department_id&agent_id&unassigned=true&search&limit&offset` | إدارة |
| GET | `/api/conversations/agent/:agent_id` | الموظف نفسه (أو إدارة) |
| GET | `/api/conversations/:contact_id/messages?before&limit` | الموظف المسؤول / إدارة |
| GET | `/api/departments` | الكل |
| GET/POST | `/api/agents` (POST ينشئ الموظف "بانتظار الموافقة" ويرسل كود توثيق) | إدارة |
| PUT / DELETE | `/api/agents/:id` (تعديل، نقل قسم، `status` / إلغاء تفعيل) | إدارة |
| POST | `/api/agents/:id/approve` · `/reject` · `/send-verification` | إدارة |
| GET | `/api/approvals/outbound?status=pending` | إدارة |
| POST | `/api/approvals/outbound/:id/approve` · `/reject {reason}` | إدارة |
| GET | `/health` | بدون توكن |

## الإشعار اللحظي (Android / Dashboard)
الكتابة من الخادم فقط. التطبيق يسجّل دخول بـ Supabase Auth ويشترك، والـ RLS يضمن أن الموظف يرى محادثاته فقط والإدارة ترى الكل:
```js
supabase.channel('inbox')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onNewMessage(p.new))
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts' }, (p) => onContactChanged(p.new))
  .subscribe();
```

## قواعد السلوك
- **Round-Robin**: الموظف الأقدم استلاماً في القسم بشرط `active` + معتمد + رقمه موثّق. القرار داخل Postgres بقفل لكل قسم فلا يتكرر التعيين مع الضغط.
- **قسم بلا موظف متاح** → يُحوَّل للإدارة؛ لو لا أحد متاح تظهر المحادثة في `admin?unassigned=true`.
- **on_break** يبقى عملاؤه عنده؛ فعّل `REROUTE_ON_BREAK=true` لتحويلهم لزميل.
- **نافذة 24 ساعة**: النص الحر مسموح خلالها فقط، بعدها `template` معتمد (الخادم يرجّع 409).
- **DELETE** = إيقاف نهائي (soft delete) يحفظ تاريخ الرسائل، ويمنع حذف آخر أدمن.
- الذكاء الاصطناعي في أول رسالة فقط؛ بدون `ANTHROPIC_API_KEY` يعمل تصنيف احتياطي بالكلمات.
- لا يُرسل للعميل رقم أي موظف، والموظف لا يرى أرقام زملائه (RLS).

## الموافقات والمصادقة
**ضم موظف** (الاثنان شرط لدخول دورة التوزيع):
1. **اعتماد الشركة**: `POST /api/agents` ينشئه `pending`، ويعتمده `/approve`. من أضافه لا يعتمده بنفسه لو يوجد أدمن آخر. `AGENT_APPROVAL=off` يلغي المرحلة. قبل الاعتماد لا يدخل التطبيق (403 `pending_approval`).
2. **مصادقة واتساب الموظف**: يصله من رقم الشركة كود 6 أرقام (قالب Authentication) فيردّ به على رقم الشركة. صالح 15 دقيقة و5 محاولات، ويُخزَّن مشفّراً (HMAC). تغيير رقمه يلغي توثيقه ويُخرجه من الدورة.

**رسائل الشركة**: `OUTBOUND_APPROVAL` = `templates` (افتراضي) أو `all` أو `none`. رسائل الإدارة والرد الآلي لا تحتاج اعتماداً. الموظف يستلم `202` وحالة `pending_approval` ثم `sent` أو `rejected`.

**مطلوب في Meta مرة واحدة**: قالب Authentication باسم `sahab_agent_verify` (لغة `ar`، زر Copy code) ينتظر الاعتماد. وتوثيق رقم الشركة واسم العرض من Meta Business Verification.
