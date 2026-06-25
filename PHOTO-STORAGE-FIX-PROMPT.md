# Photo Storage Fix — IndexedDB Migration Prompt

Paste this into a new Claude session to implement the fix.

---

I have a single-file web app at `/Users/ethanwong/my-first-app/That-Place.html` (also copied to `index.html`). It currently stores everything — including base64 photo data — in `localStorage`, which has a ~5MB browser limit. Users hit this limit after ~15–30 photos and get an alert, then lose new photos silently.

**The fix:** migrate photo blobs out of `localStorage` into `IndexedDB`, which has no practical size limit. Keep all other data (settings, places, history, etc.) in `localStorage` as-is.

## What needs to change

### 1. Add an `ImgDB` helper near the top of the `<script>` block

A thin IndexedDB wrapper with these async methods:
- `ImgDB.put(id, base64)` — store a base64 image string keyed by `id`
- `ImgDB.get(id)` — retrieve it
- `ImgDB.del(id)` — delete it
- `ImgDB.clear()` — wipe all images (for "Reset all data")

Use DB name `thatplace_imgs`, object store `imgs`, version 1.

### 2. Modify post saving (`savePost` function)

Currently saves `post.img` (base64) directly into the posts array in localStorage.

Change to:
- Generate an `imgId` = `post.id` (already unique)
- Call `await ImgDB.put(imgId, post.img)`
- Replace `post.img` with `post._imgId = imgId` before saving to localStorage
- `savePost` becomes async

### 3. Modify post rendering (`photoCard` function)

Currently reads `p.img` directly.

Change to:
- If `p._imgId` exists, async-fetch from `ImgDB.get(p._imgId)` and set the `<img>` src after the card is in the DOM
- If `p.img` exists (old data, backward compat), use it directly
- Use a grey placeholder while loading

### 4. Modify FC challenge photo saving (`fcTried` function)

Currently saves `fcDraftPhoto` (base64) into the FC log object in localStorage.

Change to:
- Store `fcDraftPhoto` in IndexedDB keyed by `'fc_' + entry.date`
- Save `_photoId: 'fc_' + entry.date` in the log instead of `photo: base64`

### 5. Modify FC photo rendering (`fcDoneHtml` and `renderFcHistory`)

These read `log.photo` (base64) to render the challenge photo.

Change to handle both `log.photo` (old data) and `log._photoId` (new), using the same async pattern as photoCard.

### 6. Modify post deletion

When a post is deleted from localStorage, also call `ImgDB.del(post._imgId)`.

### 7. Modify `resetAll()`

Add `await ImgDB.clear()` alongside the localStorage wipe.

## Backward compatibility

Existing posts with `post.img` (base64 in localStorage) should continue to display. No migration needed — just handle both cases in the render functions.

## Important constraints

- This is a **single HTML file** — all JS is inline in one `<script>` block
- No build tools, no npm packages for the frontend
- Keep all existing function names and signatures where possible
- After making changes, run: `cp That-Place.html index.html && git add . && git commit -m "migrate photos to IndexedDB" && git push`

## Files to edit
- `/Users/ethanwong/my-first-app/That-Place.html` (main file)
- `/Users/ethanwong/my-first-app/index.html` (copy of the above — update after)
