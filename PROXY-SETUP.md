# Photo-check cloud proxy — setup (one time)

This keeps your Gemini key **secret** so you can share the app and nobody has to enter a key.
The key lives only on Cloudflare's server, never in the HTML.

## 1. Deploy the Worker
```bash
npm install -g wrangler        # once
wrangler login                 # opens browser, log into a free Cloudflare account
cd /Users/ethanwong/my-first-app
wrangler deploy                # deploys worker.js using wrangler.toml
```
This prints a URL like `https://thatplace-vision.<you>.workers.dev`.

## 2. Add your Gemini key as a secret (never in the app)
```bash
wrangler secret put GEMINI_KEY
# paste your AIza… key when prompted
```

## 3. Point the app at your Worker
In `That-Place.html`, set the one constant near the top of the `<script>`:
```js
const FC_PROXY_URL = 'https://thatplace-vision.<you>.workers.dev';
```
(The Worker URL is **not** secret — hardcoding it is fine.)

## 4. Host the app so others can use it (free)
- **Cloudflare Pages**, **GitHub Pages**, or **Netlify** — upload `That-Place.html`.
- Then lock the Worker to that origin to deter abuse. In `wrangler.toml`:
  ```toml
  [vars]
  ALLOWED_ORIGIN = "https://your-app.pages.dev"
  ```
  Re-run `wrangler deploy`.

## 5. Restrict the key (recommended)
In Google Cloud Console → your API key → **API restrictions** → allow only the
**Generative Language API**. Rotate the key if you ever suspect abuse.

## Notes
- The proxy hides the **key**. A determined abuser could still spoof the Origin header and use your
  quota — the allowlist + Gemini's free-tier limits + key rotation are the mitigations.
- Local testing: `wrangler dev` runs the Worker at `http://localhost:8787`; set `FC_PROXY_URL` to
  that while testing.
- If `FC_PROXY_URL` is blank or unreachable, the app falls back to the on-device (MobileNet) check.
