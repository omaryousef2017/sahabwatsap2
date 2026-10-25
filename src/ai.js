import { config } from './config.js';

export const DEPARTMENTS = {
  sales: 'المبيعات — استفسار عن شراء/حجز وحدات، أسعار، مساحات، أنظمة سداد وعروض، استثمار',
  finance: 'المالية والأقساط — أقساط، مواعيد سداد، إيصالات، كشف حساب، تحصيل، متأخرات',
  site_visits: 'زوار المشروعات — طلب معاينة أو زيارة موقع مشروع، حجز موعد زيارة، العنوان والخرائط',
  customer_service: 'خدمة العملاء — استفسارات عامة، متابعة طلب، مشاكل بعد التسليم، أي شيء غير واضح',
  management: 'الإدارة — شكاوى جسيمة أو طلب صريح للتحدث مع مدير/إدارة',
};

const norm = (s) => s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase();

const RULES = [
  ['finance', /(قسط|اقساط|سداد|ايصال|تحصيل|دفعه|دفعة|فاتوره|فاتورة|متاخرات|كشف حساب)/],
  ['site_visits', /(معاين|اعاين|زيار|ازور|موقع المشروع|عنوان المشروع|اجي المشروع)/],
  ['management', /(شكوي|شكوى|مدير|تصعيد|الاداره|الادارة)/],
  ['sales', /(شقه|شقة|وحده|وحدة|فيلا|سعر|اسعار|حجز|تقسيط|مساحه|مساحة|تمليك|استثمار|محل|مكتب|تاون|دوبلكس)/],
];

const FALLBACK_REPLY = {
  sales: 'أهلاً بحضرتك في {co} 🌟 وصلتنا رسالتك، وهيتواصل معاك مستشار مبيعات متخصص. ممكن تقولي نوع الوحدة والمنطقة اللي بتفضلها وميزانيتك التقريبية؟',
  finance: 'أهلاً بحضرتك في {co}. وصلتنا رسالتك وهيتواصل معاك قسم المالية والأقساط. ممكن رقم العقد أو اسم الوحدة لتسريع الرد؟',
  site_visits: 'أهلاً بحضرتك في {co}. هنرتبلك زيارة المشروع، ممكن تحدد المشروع واليوم المناسب ليك؟',
  customer_service: 'أهلاً بحضرتك في {co}. وصلتنا رسالتك وهيتواصل معاك أحد ممثلي خدمة العملاء في أقرب وقت.',
  management: 'أهلاً بحضرتك في {co}. تم تحويل رسالتك للإدارة وهيتم التواصل معاك قريباً.',
};

export function keywordFallback(text) {
  const t = norm(text || '');
  const hit = RULES.find(([, re]) => re.test(t));
  const code = hit ? hit[0] : 'customer_service';
  return {
    department_code: code,
    reply: FALLBACK_REPLY[code].replace('{co}', config.companyName),
    summary: (text || '').slice(0, 200),
    source: 'keywords',
  };
}

const SYSTEM = `أنت مساعد استقبال لدى "${config.companyName}" (سحاب العقارية (SAHAB)) على واتساب. مهمتك: فهم طلب العميل الجديد وتحديد القسم المناسب وكتابة رد ترحيبي قصير يؤهّل الطلب.
الأقسام (استخدم الكود بالإنجليزية):
${Object.entries(DEPARTMENTS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
القواعد:
- الرد بالعربية بلهجة مصرية مهذبة ومهنية، 2-3 جمل كحد أقصى، بدون وعود.
- اسأل سؤال تأهيلي واحد مناسب للقسم (مثلاً للمبيعات: نوع الوحدة/المنطقة/الميزانية).
- لا تذكر أسعاراً أو توافر وحدات أو مواعيد، ولا تخترع معلومات.
- أخبر العميل أن موظفاً متخصصاً سيتواصل معه.
- اختر management فقط لو العميل طلب الإدارة صراحة أو شكوى جسيمة.
أعد JSON فقط بدون أي نص آخر وبدون علامات markdown بهذا الشكل:
{"department_code":"sales","reply":"...","summary":"ملخص من سطر واحد لطلب العميل للموظف"}`;

export async function qualifyLead({ text, name }) {
  if (!config.ai.apiKey) return keywordFallback(text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': config.ai.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ai.model,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: `اسم العميل: ${name || 'غير معروف'}\nرسالته: ${text}` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const code = DEPARTMENTS[parsed.department_code] ? parsed.department_code : 'customer_service';
    const reply = String(parsed.reply || '').trim().slice(0, 900);
    if (!reply) throw new Error('empty AI reply');
    return { department_code: code, reply, summary: String(parsed.summary || text).slice(0, 300), source: 'ai' };
  } catch (e) {
    console.warn('[ai] fallback to keywords:', e.message);
    return keywordFallback(text);
  } finally {
    clearTimeout(timer);
  }
}
