# Unified watch progress: ONE EPISODE = ONE PROGRESS

Dizi (`db.js` `progress`, key `showId|epId`) is the source of truth. Servers never keep their own authoritative minute.

## Flow when a server is opened (`app.js` mountServer + `bridge.js` embedAdapter)
1. Dizi opens the server iframe and starts `embedAdapter({getFrame, origin, id})`.
2. The server's Userscript posts `{src:'dizi-resume-ext', type:'hello'|'found', id}` to Dizi (parent) when it runs / finds the video.
3. Dizi replies **only to that iframe's origin**: `{src:'dizi-resume-host', type:'seek', id, t, d}` with the unified minute (`t:null` = start from zero, e.g. episode finished).
4. The script waits up to 3 s for that reply before restoring anything (it never restores its old local minute first). No reply (old Dizi / standalone page) -> local fallback.
5. Different video length between servers: if |duration - d| > 90 s the minute is scaled by ratio, otherwise the same seconds are used.
6. The script posts `{type:'time', t, d}` every 3 s (>= 3 s only). Dizi saves it to `progress` after checking window (`event.source` is that iframe), `event.origin`, and `id`.
7. Anti-overwrite: for 30 s after opening a server Dizi ignores a `time` that is more than 15 s older than the unified minute (a new server starting from 0 cannot overwrite it). A switch loses at most the last ~3 s.

## Adapter contract (Dizi side, `embedAdapter`)
`getCurrentTime()`, `getDuration()`, `seekTo(t, d)`, `onProgress(cb)`, `onReady(cb)`, `destroy()`.

## Add a server
1. One line in `servers.js`: `{ name, origin, url(id), hint? }` (key = code in `ep.sv`).
2. A Userscript for that origin using the same messages (copy `extension/userscripts/dizi-ok-resume.user.js`; change `@match` and the id parser; keep the host/`kick`/`PICK` logic).
3. If the server offers an official player API or a same-origin HTML5 `<video>`, write an adapter with the same 5 methods and skip the Userscript.
4. If a server gives no way to read time or seek, list it in `servers.js` without a script: it plays, but has no resume (do not claim otherwise).
