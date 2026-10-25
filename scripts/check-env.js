import 'dotenv/config';
const e = process.env;
const bad = (v) => !v || /YOUR-PROJECT|PASTE_|ضع_|xxxx/i.test(v);
const miss = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => bad(e[k]));
if (miss.length) {
  console.error('\n✖ ملف .env ناقص: ' + miss.join(', '));
  console.error('  افتح .env واملأ القيم من Supabase -> Project Settings -> API Keys ثم احفظ (Ctrl+S).\n');
  process.exit(1);
}
console.log('✔ .env OK');
