// نسخة احتياطية لقاعدة D1 (الحسابات والمفضلة والتقدم والاشتراكات) + اختبار استعادة معزول.
// الاستخدام (من مجلد worker):
//   node scripts/backup.mjs            ← يصدّر نسخة إلى C:\Work\Archive\dizi-backups ويتحقق منها بالاستعادة في قاعدة SQLite محلية (لا يمس الإنتاج)
//   node scripts/backup.mjs --verify <ملف.sql>   ← يتحقق من نسخة موجودة فقط
// القراءة من الإنتاج فقط (export)، ولا يكتب شيئًا فيه. الملف يحوي بيانات خاصة (أرقام/جلسات مُهشّمة): يبقى في Archive ولا يُرفع إلى GitHub.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = process.env.DIZI_BACKUP_DIR || 'C:/Work/Archive/dizi-backups';
const TABLES = ['members', 'subs', 'outbox', 'sent', 'meta', 'invites', 'users', 'sessions', 'otp', 'favs', 'prog', 'otp_log'];
const q = (s) => (process.platform === 'win32' && /\s/.test(s) ? `"${s}"` : s);   // cmd.exe: أي وسيط فيه مسافات يُقتبس
const wr = (...a) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler@3.114.0', ...a.map(q)], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28 });

function restoreCheck(file) {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(file, 'utf8'));          // استعادة كاملة في ذاكرة محلية معزولة
  const counts = {}; for (const t of TABLES) { try { counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { counts[t] = null; } }
  const ok = db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
  return { counts, ok };
}
function remoteCounts() {
  const sqlq = 'SELECT ' + TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ');   // صف واحد (D1 يحدّ عدد مصطلحات UNION)
  const out = wr('d1', 'execute', 'dizi-alerts', '--remote', '--json', '--command', sqlq);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0];
}

const vi = process.argv.indexOf('--verify');
if (vi > 0) { const r = restoreCheck(process.argv[vi + 1]); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }

mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const file = join(DIR, `dizi-alerts-${stamp}.sql`);
wr('d1', 'export', 'dizi-alerts', '--remote', '--output', file);
const back = restoreCheck(file), live = remoteCounts();
const diff = TABLES.filter((t) => back.counts[t] !== live[t]);
console.log(JSON.stringify({ file, bytes: statSync(file).size, integrity: back.ok, restored: back.counts, live, mismatch: diff }, null, 1));
process.exit(back.ok && !diff.length ? 0 : 1);
