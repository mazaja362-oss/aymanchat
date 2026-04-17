# Ayman Chat

تطبيق ويب للمحادثات الفورية (نصية) بين مستخدمين مسجلين. الاسم المعروض: **Ayman Chat**.

## ما الذي يفعله البرنامج؟

- **تسجيل حساب** باسم مستخدم (إنجليزي صغير + أرقام + `_`) وكلمة مرور واسم ظاهر.
- **تسجيل الدخول** والاحتفاظ بالجلسة في المتصفح.
- **قائمة المستخدمين** (كل الحسابات ما عدا حسابك).
- **محادثة خاصة** مع أي مستخدم: تحميل السجل + إرسال واستقبال فوري عبر WebSocket (Socket.io).
- **مكالمة صوت/فيديو (تجريبية)** بين مستخدمين عبر WebRTC مع إشارات عبر الخادم (زرّي 📞 و 📹 داخل المحادثة الخاصة).

## المتطلبات على جهازك

- **Node.js 18 أو أحدث** ([تحميل Node](https://nodejs.org/))
- اتصال بالإنترنت عند **أول تشغيل** فقط (لتنزيل الحزم من npm).

## التثبيت (مرة واحدة)

من مجلد المشروع `ayman-chat`:

```bash
npm install
cd server && npm install && cd ../client && npm install && cd ..
```

أو من جذر المشروع:

```bash
npm run install:all
```

## التشغيل اليومي (وضع التطوير)

شغّل الخادم والواجهة معاً:

```bash
npm run dev
```

ثم افتح المتصفح على:

`http://localhost:5173`

- **الخادم (API + المحادثة الفورية):** `http://localhost:3000`
- **الواجهة (Vite):** `http://localhost:5173` — الطلبات إلى `/api` و`/socket.io` تُوجَّه تلقائياً للخادم.

### تجربة سريعة بين شخصين

1. افتح نافذة عادية وسجّل حساباً (مثلاً `user_one`).
2. افتح **نافذة تصفح خاصة (Incognito)** وسجّل حساباً ثانياً (مثلاً `user_two`).
3. في كل نافذة ستظهر المستخدم الآخر في القائمة — اختره وابدأ المراسلة.

## البيانات والتخزين

- **الوضع الافتراضي:** تُحفظ الحسابات والرسائل كملفات JSON في `server/data/` (`users.json`, `messages.json`, …).
- **اختياري — `USE_SQLITE=1`:** نفس البيانات في ملف **`ayman.sqljs.db`** عبر مكتبة **sql.js** (بدون تجميع أصلي). عند أول تشغيل مع قاعدة فارغة يُستورد تلقائياً من ملفات JSON الموجودة إن وُجدت.
- **نسخ احتياطي:** انسخ مجلد `server/data/` بالكامل (أو volume Docker `ayman_data`) قبل الترقية أو النقل.
- المجلد يُنشأ تلقائياً عند أول تشغيل. احذف المحتوى لإعادة «تفريغ» التطبيق (مع العلم أن SQLite قد يعيد استيراد JSON إن بقيت الملفات).

## الأمان (مهم قبل أي استخدام حقيقي)

- **JWT:** المفتاح الافتراضي للتطوير مضمّن في الكود للتشغيل السريع. قبل أي نشر:
  - عيّن متغير بيئة **`JWT_SECRET`** (سلسلة عشوائية طويلة ومعقّدة).
  - يمكنك نسخ `server/.env.example` إلى `server/.env` وتعديل القيم محلياً (لا ترفع `.env`).
- **الاتصال:** هذا المشروع للتطوير المحلي؛ للإنترنت العام استخدم **HTTPS** ووسيط عكسي (مثل nginx) وقيود مناسبة.
- **كلمات المرور:** تُخزَّن مشفّرة بـ bcrypt على الخادم فقط.
- **تسجيل الدخول والتسجيل:** يوجد حدّ لمعدل الطلبات لكل عنوان IP لتقليل محاولات القوة الغاشمة.

## متغيرات البيئة (اختياري)

| المتغير        | المعنى                          | الافتراضي                |
|----------------|-----------------------------------|---------------------------|
| `PORT`         | منفذ الخادم                     | `3000`                    |
| `CLIENT_ORIGIN`| أصل الواجهة المسموح (CORS/Socket) | `http://localhost:5173`   |
| `JWT_SECRET`   | مفتاح توقيع الرموز              | قيمة تطوير (غيّرها)      |
| `CLIENT_DIST`  | مجلد `client/dist` لخدمة SPA من Express | — (اختياري)        |
| `USE_SQLITE`   | `1` لتفعيل تخزين sql.js بدل ملفات JSON فقط | `0` / غير معيّن |
| `SQLITE_PATH`  | مسار ملف قاعدة sql.js                  | `server/data/ayman.sqljs.db` |
| `ICE_SERVERS_JSON` | مصفوفة JSON لخوادم STUN/TURN لـ WebRTC | STUN افتراضي من `/api/webrtc/ice` |

مثال تشغيل على ويندوز (PowerShell):

```powershell
$env:JWT_SECRET="ضع_هنا_سلسلة_طويلة_عشوائية"
$env:PORT="3000"
npm run start
```

ثم ابنِ الواجهة وقدّمها كملفات ثابتة أو شغّل `client` بـ `npm run dev --prefix client` مع ضبط `CLIENT_ORIGIN` ليطابق عنوان الواجهة.

## بناء الواجهة للإنتاج

```bash
npm run build --prefix client
```

المخرجات في `client/dist/`.

### خادم واحد (API + الواجهة + Socket.io)

بعد البناء، مرّر مسار `dist` إلى الخادم بمتغير **`CLIENT_DIST`** (مسار مطلق أو نسبي لمجلد `client/dist`). عندها يخدم Express الملفات الثابتة و`index.html` للمسارات غير API، مع الإبقاء على `/api` و`/uploads` و`/socket.io`.

```powershell
$env:CLIENT_DIST="C:\Users\YOU\Projects\ayman-chat\client\dist"
$env:CLIENT_ORIGIN="http://localhost:3000"
$env:PORT="3000"
npm run start --prefix server
```

افتح `http://localhost:3000` (يجب أن يطابق `CLIENT_ORIGIN` أصل المتصفح حتى يعمل CORS واتصال Socket.io).

## Docker

يتطلّب [Docker](https://docs.docker.com/get-docker/) وDocker Compose.

```bash
docker compose up --build
```

ثم المتصفح على **`http://localhost:3000`**. البيانات في مجلد Docker volume اسمه `ayman_data`.

- إذا غيّرت منفذ الاستضافة على الجهاز (مثلاً `8080:3000`)، عيّن **`CLIENT_ORIGIN`** ليطابق ما يكتبه المتصفح في شريط العنوان، مثلاً:  
  `CLIENT_ORIGIN=http://localhost:8080 docker compose up`
- للإنتاج خلف HTTPS، استخدم `CLIENT_ORIGIN=https://اسم-النطاق` ووسيطاً عكسياً يمرّر WebSocket.

## اختبار دخان (API)

من جذر المشروع (يُشغّل خادماً مؤقتاً على المنفذ 3049 افتراضياً):

```bash
npm run test:smoke
```

## CI (GitHub Actions)

عند الدفع إلى `main` أو `master` أو فروع `feat/**` يُشغَّل سير عمل **CI** يقوم بـ: تثبيت الحزم، بناء الواجهة، اختبار دخان API مرتين (JSON ثم `USE_SQLITE=1`)، ثم **Playwright** على Chromium. الملف: `.github/workflows/ci.yml`.

## اختبارات طرفية (Playwright)

```bash
npm install
npm run install:all
npx playwright install chromium
npm run test:e2e
```

يُشغِّل `playwright.config.ts` خادماً مؤقتاً عبر `scripts/e2e-serve.mjs` (بناء + `CLIENT_DIST`). يتضمّن اختباراً لمحادثة بين مستخدمين (`e2e/two-user-chat.spec.ts`).

## nginx و HTTPS

مثال إعداد وسيط عكسي مع WebSocket: `deploy/nginx-ayman-chat.example.conf` — انسخه وعدّل النطاق والشهادات.

## WebRTC: STUN و TURN

- الواجهة تجلب إعدادات ICE من **`GET /api/webrtc/ice`** (افتراضياً: STUN العام لـ Google).
- لتفعيل **TURN** (موصى به خلف NAT صارم): شغّل خادماً مثل **coturn**، ثم عيّن على خادم التطبيق متغير **`ICE_SERVERS_JSON`** بمصفوفة JSON لـ `RTCIceServer[]` (انظر مثال الملف `deploy/docker-compose.coturn.example.yml` وتعليقاته).

## استكشاف الأخطاء

| المشكلة | ما يمكن فعله |
|---------|----------------|
| `EADDRINUSE` على المنفذ **3000** | شيء آخر يستخدم 3000 (غالباً تشغيل سابق لـ Ayman Chat). إما أوقف العملية بعد معرفة الـ PID بـ `netstat -ano` ثم `taskkill /PID ... /F`، أو شغّل على منفذ آخر من جذر المشروع: `$env:PORT="3001"; npm run dev` (وكيل Vite يستخدم نفس `PORT` تلقائياً). |
| الصفحة لا تتصل بالخادم | شغّل من **جذر المشروع** `npm run dev` (خادم + واجهة). إذا شغّلت الواجهة وحدها (`npm run dev --prefix client`) يجب أن يعمل الخادم قبلها على **نفس `PORT`** (مثلاً `npm run dev --prefix server` مع `$env:PORT="3001"` إن كان الوكيل يوجّه إلى 3001). |
| `http proxy error` + `ECONNREFUSED` في طرف Vite | غالباً **لا يوجد خادم** على المنفذ المستهدف، أو الخادم ما زال يقلع. استخدم `npm run dev` من الجذر، أو انتظر حتى يظهر `Ayman Chat server http://localhost:...`. |
| «غير مصرح» بعد التحديث | احذف التخزين المحلي للموقع أو سجّل خروجاً ثم دخولاً. |
| لا يظهر مستخدمون | تحتاج حسابين على الأقل؛ أنشئ حساباً ثانياً في نافذة/متصفح آخر. |

## هيكل المشروع

```
ayman-chat/
  package.json          # أوامر تشغيل مجمّعة
  server/               # Express + Socket.io
    src/index.js
    data/               # يُنشأ تلقائياً — لا تُلزم Git
  client/               # React + Vite + TypeScript
    src/
```

## الترخيص

مشروع شخصي/تعليمي — عدّل واستخدم كما تشاء.

---

**ملخص:** بعد `npm run install:all` ثم `npm run dev`، افتح `http://localhost:5173` وسجّل حسابين لتجربة **Ayman Chat** فوراً.


