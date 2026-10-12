# Live AI stories — setup

The site works without a backend (sample stories). To turn on live generation:

## 1. Deploy the API to Vercel
1. vercel.com → **Add New → Project** → import `mayerhelen175-web/maya`. Framework preset: **Other**. No build command.
2. **Settings → Environment Variables**:
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | key from console.anthropic.com (required) |
   | `MAYA_ALLOWED_ORIGIN` | `https://mayerhelen175-web.github.io` |
   | `MAYA_STORY_MODEL` | optional, default `claude-sonnet-5-5` |
   | `MAYA_MODERATOR_MODEL` | optional, default `claude-haiku-5-5` |
   | `MAYA_RATE_PER_HOUR` | optional, default `12` per IP |
3. Deploy. The endpoint is `https://<project>.vercel.app/api/story`.
4. In console.anthropic.com set a **monthly spend limit** — the endpoint is public.

## 2. Point the site at it
In `index.html`, in `<head>`:
```html
<script>window.MAYA_API = window.MAYA_API || 'https://<project>.vercel.app/api/story';</script>
```
Empty string = demo mode.

## How it works
- The browser sends only allowlisted fields: `age, pron, cat, topic, mood, langs (en/es/ru, max 2), family`. **No name, no free text, no photo.**
- The model writes `{HERO}`; the browser replaces it with the name on the device.
- Pipeline: generate → static checks (banned themes EN/ES/RU, brands, unlisted relatives, `{HERO}`, 4 pages, all languages) → LLM moderator → up to 3 attempts → `422 {fallback:true}`.
- Any error, timeout (45 s) or 422/429/503 → the site shows a pre-approved sample story.
- Server logs a moderation audit trail (input choices + issues), no personal data.

## Before launch (counsel / ops)
- Sign Anthropic's commercial terms; confirm zero/limited data retention for the API.
- Per-IP limit is per warm instance — move to a shared store (Upstash/Vercel KV) and tie to the paid pass.
- Add the AI provider to the Privacy Policy subprocessor list and the COPPA direct notice.

## Tests
`npm test` (Node 18+) — validation, static checks, retry and fallback with a mocked API.
