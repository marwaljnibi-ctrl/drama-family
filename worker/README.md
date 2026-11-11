# dizi-alerts (Cloudflare Worker، مجاني)
تنبيهات واتساب للحلقات الجديدة. الكشف من `data/shows.json` (قائمة `latest` الموجودة)، بلا فهرسة ثانية. الإرسال **معطّل افتراضيًا**.

- التخزين: KV `DIZI_ALERTS`. الأعضاء يُخزَّنون بـ SHA-256 لرابطهم الخاص (الرابط نفسه لا يُحفظ).
- الأسرار (Cloudflare Secrets): `ADMIN_KEY`, `UM_API_KEY` (UnlimitedMessaging). لا تُكتب في الكود ولا GitHub.
- مفتاح الإدارة المحلي: `worker/.admin-key` (في .gitignore).

## إدارة (Authorization: Bearer <ADMIN_KEY>)
- `POST /admin/member {name, phone:+E164}` → رابط خاص يظهر مرة واحدة. `POST /admin/rotate {phone}` رابط جديد. `POST /admin/remove {phone}`.
- `POST /admin/enable {on:true|false}` تشغيل/إيقاف الإرسال (الإيقاف يمسح الطابور). `GET /admin/status`. `POST /admin/test {phone}` رسالة تجريبية واحدة.
- لا إشعار لأي حلقة موجودة وقت أول تشغيل (نقطة البداية = `seen`). لا رسالة لعضو بلا موافقة صريحة يمنحها من رابطه. إلغاء الاشتراك/الموافقة يحذف المعلّق فورًا. علامة `sent:<عضو>:<حلقة>` تمنع التكرار.

## النشر
`cd worker && npx wrangler@3.114.0 deploy` — ثم `npx wrangler secret put UM_API_KEY`.
