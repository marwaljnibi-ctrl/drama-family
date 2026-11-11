#!/usr/bin/env bash
# يشغّل مزامنة qesset على دفعات، ويحفظ (commit + push) بعد كل دفعة؛ فيصل التقدم إلى GitHub ولا يضيع إن توقف التشغيل.
# كل دفعة تبدأ باكتشاف الحلقات الجديدة (أول ثوانٍ)، فلا تتأخر الحلقات الجديدة أثناء الفهرسة الطويلة.
# يتوقف فورًا عند: حجب المصدر، فشل السكربت، أو نسبة فشل أعلى من 20% في دفعة.
set -u
TOTAL="${LIMIT:-300}"; CHUNK="${SYNC_CHUNK:-250}"; done_n=0; zero=0
git config user.name "sync-bot"; git config user.email "sync-bot@users.noreply.github.com"
commit_push() {
  rm -f data/shows.json.tmp
  git add data
  git diff --cached --quiet && return 0
  git commit -qm "sync: update shows"
  for i in 1 2 3; do
    git push -q && return 0
    git pull -q --rebase --autostash || return 1
  done
  return 1
}
while :; do
  n=$(( TOTAL - done_n )); [ "$n" -gt "$CHUNK" ] && n=$CHUNK; [ "$n" -lt 1 ] && n=1
  out=$(SYNC_SERVERS_PER_RUN=$n node scripts/sync-qesset.mjs 2>&1); rc=$?
  echo "$out"
  commit_push || { echo "::error::push failed"; exit 1; }
  [ "$rc" -ne 0 ] && { echo "::error::sync script failed (rc=$rc)"; exit "$rc"; }
  echo "$out" | grep -q 'BLOCKED by source' && { echo "::error::blocked by source; stopped"; exit 1; }
  line=$(echo "$out" | grep 'servers:' | tail -1)
  res=$(echo "$line" | sed -E 's/.*\+([0-9]+) resolved.*/\1/'); fail=$(echo "$line" | sed -E 's/.* ([0-9]+) failed.*/\1/'); pend=$(echo "$line" | sed -E 's/.* ([0-9]+) still pending.*/\1/')
  echo "CHUNK n=$n resolved=${res:-?} failed=${fail:-?} pending_after=${pend:-?} done=$((done_n+n))/$TOTAL"
  [ -n "${fail:-}" ] && [ "$((fail * 5))" -gt "$n" ] && { echo "::error::failure rate above 20%; stopped"; exit 1; }
  done_n=$((done_n + n))
  [ "${pend:-1}" = "0" ] && break
  [ "$done_n" -ge "$TOTAL" ] && break
  if [ "${res:-0}" = "0" ]; then zero=$((zero+1)); else zero=0; fi
  [ "$zero" -ge 2 ] && { echo "::error::two chunks resolved nothing; stopped"; exit 1; }
done
echo "sync-run finished: processed up to $done_n of requested $TOTAL"
