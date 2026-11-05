# PASIYA API (Vercel Functions · Node.js, no framework, no dependencies)

```
api/index.js  (+ system/router.js)  ← the only Vercel Function (all /api/* goes through it)
vercel.json                    ← tells Vercel: no framework, serve public/, functions in api/
public/index.html              ← dashboard (served at "/")
system/                        ← the PLATFORM (no scraping here)
  util.js  db.js  gateway.js  account.js  status.js  registry.js
scrapers/                      ← one file per site / service
  youtube  facebook  tiktok  instagram  mediafire  gdrive  catbox
  news  weather  tv  movies  ai  download      (+ _web.js = shared helpers)
```

## Add a new scraper
1. Create `scrapers/mysite.js` and `export default [{ path, category, name, cost, desc, params, run }]`
2. Add one `import` + put it in the `ALL` list in `system/registry.js`. Docs, "Test" forms, coin charging and rate limits are automatic.

## Deploy on Vercel
1. Put this folder at the ROOT of a GitHub repo (package.json + api/ + public/ visible on the repo's first page) → Vercel → **Add New Project** → import it. Leave everything default (vercel.json already sets Framework = none; Node 22).
2. **Settings → Environment Variables**: copy everything from `.env.example`. Required: `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `ADMIN_EMAIL`. Then **Redeploy**.
3. Firebase Console → **Authentication → Settings → Authorized domains** → add `your-project.vercel.app`.
4. Check `https://your-project.vercel.app/api/health` → `{"ok":true,...}`. Then open the site and login with the admin email.

Tests: `node test/run.mjs` (offline, mocked sites, no install needed).

## What changed vs the Cloudflare version
- Worker → one Vercel Function (Node.js runtime). `wrangler.toml` → Vercel environment variables.
- Cloudflare Workers AI binding → REST (`CF_ACCOUNT_ID` + `CF_API_TOKEN`, free). Without it, set any of Gemini / OpenRouter / Groq / DeepSeek keys.
- Cache and rate-limit are per server instance memory (Cloudflare Cache API doesn't exist on Vercel). Fine for this size; use Upstash/Vercel KV later if you need global limits.
- **No keys needed now:** AI falls back to the free public Pollinations service; movie trending falls back to the IMDb chart; video downloads (YouTube / TikTok / Facebook / Instagram) return direct links from the platforms' public data. Real keys, when set, are tried first.
- Downloads are best effort (sites change; YouTube may refuse Vercel's datacenter IPs). For maximum reliability host the separate yt-dlp service (`pasiya-scraper-api`) and set `SCRAPER_URL` + `SCRAPER_SHARED_SECRET`: it then answers the download endpoints instead.
- `maxDuration` is 30s in `vercel.json` (Hobby allows up to 60).

## v4.1
- **Fix:** Admin > API manager: switching an API on/off no longer scrolls the page to the bottom (the list is no longer rebuilt on a toggle; scroll positions are kept when it is).
- **AI:** 9 more providers from free-ai-apis (Hugging Face, SambaNova, Together, Fireworks, DeepInfra, Hyperbolic, Novita, Cohere, AIML) join every model chain when their key is set. New: `/api/ai/translate` (keyless), `/api/ai/search` (Tavily key).
- **Social:** 16 `/api/social/*` endpoints (TikTok, Instagram, X, YouTube, Facebook, Reddit) powered by Apify actors from social-media-apis. Appear only when `APIFY_TOKEN` is set.

## v4.0 (fix release)
- **AI:** official-provider chain now also has Cerebras, Mistral, GitHub Models and Anthropic; Pollinations is last and its 45 s limit is remembered (no more 14 s timeouts). Set free keys (see `.env.example`). chatgpt.com / claude.ai themselves have no public API, so they are NOT scraped: official free APIs are the reliable way.
- **News:** each site tries its own feed + common alternate paths, then Google News (Sinhala + English, 7 days), then Bing News.
- **Web Search:** Brave (key) -> Bing RSS -> DuckDuckGo. **Tempmail:** mail.tm with mail.gw fallback. **YouTube DL:** 3 app clients + optional cobalt (`COBALT_API_URL`). **Movies:** details example now keyless (`tt...`), trending reads IMDb `__NEXT_DATA__`; a free `TMDB_API_KEY` is still best.
- Health check timeout 25 s. Tests: `node test/run.mjs` and `node test/fixes.mjs`.
- "NEEDS REAL INPUT" is normal: the example link in the test is fake, so that API is not proven broken.

## v3.9
- **Admin Panel > Feature switches:** turn the Daily claim and the Lucky Spin on/off for everyone (stored in Firestore `settings/features`). They are shown ONLY to signed-in normal users: guests and admins never see them (the server blocks them too).
- **Admin Panel > API manager:** *Run health check* tests every API from the live server (Vercel) in small batches; *Switch off failed* hides the broken ones from the catalog (they answer 503). Every API also has its own on/off switch. Admins can still test switched-off APIs.
- **Removed:** `/api/thenux-ai`, `/api/twitter_v2`.
- **New:** `/api/video/hd` (best-quality links + every quality, with the "send as Document, not as Status" WhatsApp tip), `/api/tools/qr`, `/api/tools/ip`.
- **Mobile:** the menu is now a hamburger button (top right) that slides a drawer in from the right. Smaller logo + name in the bar.
- **Music:** 5 background songs with Play/Pause, Next and Previous in the menu. Browsers only allow sound after the first tap or click, so autoplay starts on the first touch. Pausing is remembered on that device.
- Not built on purpose: sinhalasub.lk (full movies / episodes = piracy), same rule as the other pirated sites below.

## v3.4: 14 more AI endpoints (ChatGPT, DeepSeek, Gemma, Kimi, GLM, MiniMax, Coder, BlackBox, Answer Engine, Quick Answers, NoteGPT, Sinhala Assistant, Flux image, Nano Banana). Model ids can be overridden with MODEL_* env vars.

## v3.5: scrapers/more_dl.js adds YouTube MP4/MP3/Thumbnail DL, TikTok/Facebook/Instagram/Pinterest DL, Twitter (X) video, Pixeldrain, Spotify info.

## v3.3 changes
- **Key system stays:** every API needs the user's PASIYA key (dashboard shows it). "Keyless" now only means the APIs use public sources and need **no third-party keys**. `ALLOW_KEYLESS=1` (optional) lets anonymous callers use free APIs.
- **Admin fix:** `ADMIN_EMAIL` is trimmed, case-insensitive, accepts a comma list, ignores Gmail dots/+tags. Admin also needs a *verified* e-mail (Google login is always verified). `/api/config` shows `adminConfigured`.
- **Pages:** `/login` (username or e-mail, Google) and `/register` (username, e-mail, confirm password, `SIGNUP_COINS` bonus). No GitHub, no Cloudflare check.
- **Endpoints:** `scrapers/newsfeeds.js` (36 news sites + all-in-one), `search.js`, `utility.js`, `extras.js` (F-Droid APK, Internet Archive music, TikTok public avatar, Wikimedia live wallpapers, Web2Zip).
- **Status:** the dashboard now has a **USERS** card (registered accounts, cached 60 s).
- Not built on purpose: WhatsApp channel reacts (spam / engagement faking), WhatsApp DP saver (privacy), pirated APK / MP3 sites.
