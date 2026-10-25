import 'dotenv/config';

const dryRun = String(process.env.DRY_RUN).toLowerCase() === 'true';

function need(key, { optionalInDryRun = false } = {}) {
  const v = process.env[key];
  if (!v && !(optionalInDryRun && dryRun)) throw new Error(`Missing env var: ${key}`);
  return v || '';
}

export const config = {
  port: Number(process.env.PORT || 3000),
  dryRun,
  rerouteOnBreak: String(process.env.REROUTE_ON_BREAK).toLowerCase() === 'true',
  // none = بدون موافقة | templates = القوالب فقط (افتراضي) | all = كل رسائل الموظفين
  outboundApproval: ['none', 'templates', 'all'].includes(process.env.OUTBOUND_APPROVAL) ? process.env.OUTBOUND_APPROVAL : 'templates',
  // on = الموظف الجديد يحتاج موافقة إدارية | off = يُعتمد تلقائياً (التوثيق بالواتساب مطلوب في الحالتين)
  agentApproval: String(process.env.AGENT_APPROVAL || 'on').toLowerCase() === 'off' ? 'off' : 'on',
  verifyTemplate: process.env.AGENT_VERIFY_TEMPLATE || 'sahab_agent_verify',
  companyName: process.env.COMPANY_NAME || 'سحاب العقارية',
  companyWhatsapp: (process.env.COMPANY_WHATSAPP || '201055523412').replace(/\D/g, ''),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  meta: {
    token: need('META_ACCESS_TOKEN', { optionalInDryRun: true }),
    phoneNumberId: need('META_PHONE_NUMBER_ID', { optionalInDryRun: true }),
    verifyToken: need('META_VERIFY_TOKEN'),
    appSecret: need('META_APP_SECRET'),
    apiVersion: process.env.META_API_VERSION || 'v23.0',
  },
  supabase: {
    url: need('SUPABASE_URL'),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  },
};
