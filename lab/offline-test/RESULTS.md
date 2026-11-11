# Offline test lab — results so far (desktop Chromium only; iPhone = PENDING)

Preview: https://exp-offline-lab.dizi-preview.pages.dev/lab/offline-test/  (branch `exp/offline-lab`, separate from Dizi)

## Measured (Chromium, 2026-11-11)
| Test | Result |
|---|---|
| Real MP4 download (MDN flower.mp4, CORS+Range) -> OPFS, verify (size, box walk, seeks) | PASS |
| Real 286.5 MB WebM (Wikimedia, CORS+Range) -> OPFS in chunks of 8 MB, ~53 s, size==Content-Length, EBML header, seeks | PASS |
| Pause at 14% and resume -> continued from 40 MB (not from 0), complete + verified | PASS |
| Synthetic 256 MB valid MP4 (sample + `free` padding) written chunk by chunk, verified | PASS |
| CORS hides `Content-Range` (not exposed by the source) -> total taken from HEAD `Content-Length` (fix in `dl2.js`) | PASS after fix |

## Sources (headers only; no content downloaded beyond a few bytes)
| Source | Media | JS can read | CORS | Range | Temporary | Verdict |
|---|---|---|---|---|---|---|
| Cloud.Mail (Express) | MP4 3.78 GB via `getMailruDownloadHref` (301 to datacloudmail.ru) | no | none | 206 yes | base link IP-bound | BLOCKED by CORS (no authorized free proxy) |
| Arab HD | HLS (TS segments 10 s) on artrk.online | playlists+segments yes | `*` | segments 206 | token `e=43200` (12 h) | URL only inside the cross-origin embed page; needs authorization decision + local HLS packaging. Not downloaded. |
| Turk | embed host unreachable from the test machine | n/a | n/a | n/a | n/a | not tested |
| OK | not tested (server deferred) | n/a | n/a | n/a | n/a | not tested |

## iPhone (iOS 18.7, Safari tab, not PWA) — user report 2026-11-11
Environment: OPFS true, Worker true, quota 38.4 GB, usage 4.53 GB, persisted=false (not requested), WebM probably, MP4 maybe.
| Test | Result |
|---|---|
| Stored + complete + valid (size==total, box walk / EBML): synthetic 256 MB, synthetic 4.00 GB, real MP4 1.1 MB, real WebM 286.5 MB | PASS |
| `complete=true` is only written after verify, which includes real seeks (50%, 97%, 10%) on the stored file | implied PASS for the 4 files |
| Play metadata from OPFS while offline (online=false): 256 MB and 4 GB, 960x540 | PASS |
| Play metadata online | PASS |
| Seek in the player UI while offline, pause/resume on iPhone, survive Safari close + phone restart, persist(), PWA mode, storage-pressure eviction | NOT YET TESTED |
Caveat: the 4 GB file is a small real MP4 plus `free` padding; it proves storage/blob-URL handling, not decoding 4 GB of real video.
