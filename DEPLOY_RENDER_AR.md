# رفع المشروع على GitHub ثم Render (مجاني)

## 1) GitHub
1. على github.com اعمل **New repository** باسم `sahab-wa-engine` واختر **Private**، وبدون README أو .gitignore.
2. انسخ رابط الريبو (ينتهي بـ `.git`).
3. شغّل `push-to-github.bat` من داخل مجلد المشروع، والصق الرابط. السكربت يتوقف لو `.env` معرّض للرفع.
   - لو طلب منك Git الاسم والإيميل: `git config --global user.name "Your Name"` و `git config --global user.email "you@mail.com"` ثم أعد التشغيل.

## 2) Render
1. **New ← Blueprint** واختر الريبو؛ سيقرأ `render.yaml` تلقائياً.
2. أدخل قيم الأسرار حسب `.env` عندك:
   `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ANON_KEY` · `META_VERIFY_TOKEN` · `META_APP_SECRET` · `ANTHROPIC_API_KEY`
   - `META_ACCESS_TOKEN` و`META_PHONE_NUMBER_ID`: اكتب أي قيمة مؤقتة (مثل `pending`) ما دام `DRY_RUN=true`.
3. بعد النشر ادخل `https://<اسم-الخدمة>.onrender.com/health` وتأكد من `"ok":true`.
4. الداشبورد على الرابط نفسه، والـ Webhook: `https://<اسم-الخدمة>.onrender.com/webhook`.

## 3) منع النوم (الخطة المجانية)
اعمل مراقب على UptimeRobot يفتح `/health` كل 5 دقائق.

## 4) تشغيل الإرسال الفعلي
في Render ← Environment حدّث `META_ACCESS_TOKEN` و`META_PHONE_NUMBER_ID` بالقيم الحقيقية، ثم `DRY_RUN=false` واحفظ (تتم إعادة النشر تلقائياً). وفي Meta ضع Callback URL والـ Verify token ثم اشترك في `messages`.

## ملاحظات
- لا ترفع `.env` أبداً. الأسرار تُدخل من لوحة Render فقط.
- إنشاء حساب الأدمن (`npm run setup:admin`) يتم مرة واحدة من جهازك وليس على Render.
