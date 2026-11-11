# Dizi family release — protected baseline & rollback

## Verified on iPhone (iOS 18.7, Safari + Userscripts)
Arab HD auto-resume: saves position, restores after closing the episode and after a phone restart,
works across several shows/episodes, from a Home Screen icon that opens regular Safari. No download, no proxy.

- Commit:  `51cc20cd13f0cdb7d42a9ac3362e612f3b9445a5`
- Branch (frozen backup): `backup/resume-ok-51cc20c`
- Tag: `resume-ok-v0.1.0`
- Script (stable, tag-pinned URL; does not move when branches change):
  `https://raw.githubusercontent.com/marwaljnibi-ctrl/drama-family/resume-ok-v0.1.0/extension/userscripts/dizi-arabhd-resume.user.js`
  (sha256 starts `4c7065d7503a7973`, identical to the file at 51cc20c)

## Rules for the family work (`exp/family-v1`)
- `extension/userscripts/dizi-arabhd-resume.user.js` is NOT edited here. Storage keys `pos:<embed id>` (Userscripts)
  and IndexedDB stores `favs`, `progress`, `dlmeta`, `dlblob` keep their names and key formats (`showId|epId`).
- Any new data goes in new stores/fields, never by renaming or removing existing ones.

## Rollback
- Code: `git checkout resume-ok-v0.1.0` (or `git checkout backup/resume-ok-51cc20c`), or redeploy that tag to the preview.
- Script: nothing to roll back on devices already installed; reinstall from the tag URL above if needed.
- Production (`main`) is untouched by this work.
