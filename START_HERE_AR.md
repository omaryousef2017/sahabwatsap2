# سحاب العقارية — تشغيل من الصفر (ويندوز)

## 0) تنبيه أمان
المفتاح السري (service_role) اتكشف قبل كده. من Supabase -> Project Settings -> API Keys اعمل Regenerate للمفتاح السري، واستخدم الجديد في .env. لا ترفع .env لأي حد.

## 1) املأ .env  (انسخ .env.example إلى .env)
- SUPABASE_SERVICE_ROLE_KEY = المفتاح السري الجديد
- SUPABASE_ANON_KEY = المفتاح العام (publishable)
- ADMIN_PASSWORD = باسورد الأدمن اللي تحبه (8 أحرف أو أكتر)
- DATABASE_URL = من Supabase: زر Connect -> Session pooler، وحط باسورد قاعدة البيانات مكان [YOUR-PASSWORD]
  (لو الباسورد فيه رموز مثل @ أو # لازم تتكتب URL-encoded، أو غيّر الباسورد لحروف وأرقام فقط من Project Settings -> Database)

## 2) الإعداد (مرة واحدة) داخل مجلد المشروع في terminal
    npm install
    npm run setup
الأمر ده بيعمل: الجداول والدوال والأمان، ثم ينشئ/يحدّث مستخدم الأدمن ويضبط باسورده ويؤكد إيميله، ثم يختبر الدخول فعلياً.
لازم تشوف في الآخر: ✔ اختبار الدخول نجح

## 3) التشغيل
    npm start
افتح http://localhost:3000 وادخل بـ ADMIN_EMAIL و ADMIN_PASSWORD.
أو اضغط دبل كليك على START_WINDOWS.bat.

## 4) تجربة بدون واتساب حقيقي (terminal ثاني)
    npm run simulate -- 3 "عايز شقة 3 غرف"

## لو DATABASE_URL مش متاح
افتح Supabase -> SQL Editor، اختار Role = postgres (مش authenticated)، الصق محتوى sql/00_ALL_IN_ONE.sql وشغّله، وبعدها نفّذ: npm run setup:admin

## ربط واتساب الحقيقي
رقم الشركة 01055523412. خطوات Meta في README.md (DRY_RUN=false + META_ACCESS_TOKEN + META_PHONE_NUMBER_ID + Webhook على /webhook).
