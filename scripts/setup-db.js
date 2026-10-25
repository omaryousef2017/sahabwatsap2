import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || /YOUR-PASSWORD/.test(url)) {
  console.error('\n✖ DATABASE_URL غير مضبوط في .env');
  console.error('  Supabase -> زر Connect -> Session pooler -> انسخ الرابط وحط باسورد قاعدة البيانات مكان [YOUR-PASSWORD].');
  console.error('  أو شغّل sql/00_ALL_IN_ONE.sql يدوياً في SQL Editor بعد اختيار Role = postgres.\n');
  process.exit(1);
}
const sql = fs.readFileSync(new URL('../sql/00_ALL_IN_ONE.sql', import.meta.url), 'utf8');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  await c.query(sql);
  const r = await c.query("select count(*)::int n from departments");
  console.log(`✔ قاعدة البيانات جاهزة (الأقسام: ${r.rows[0].n})`);
} catch (e) {
  console.error('✖ فشل إعداد قاعدة البيانات:', e.message);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
