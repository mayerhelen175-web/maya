# Maya — bedtime stories where your child is the hero

Demo website for US families: personalized bilingual stories (English / Spanish), audio-only bedtime mode,
mini films, printed book, calm kid games ("Mom's break"), the Pause corner for parents, a star map,
prepaid passes with no auto-renewal, and a scripted helper.

## Status
- `index.html` — single-file working demo (no build step). Open it in a browser or deploy as a static site.
- `api/story.js` — live AI story generation with a safety moderator (Vercel function). Off until `window.MAYA_API` is set; see `docs/ai-setup.md`.
- Payments, file downloads, photo matching and the live agent are **stubbed** and marked "Demo" in the UI.
- The site is not indexed by search engines (`noindex` + `robots.txt`).
- `docs/concept-us.md` — product concept, data map, consent system, US legal requirements and open questions for counsel.

## Run locally
Open `index.html` in any modern browser, or serve the folder:

```
npx serve .
```

## Next steps
1. Deploy `api/story.js` and set `window.MAYA_API` (see `docs/ai-setup.md`).
2. Add auth, database and payments (one-time passes, no subscriptions).
3. Connect the Maya Helper agent and SMS channel (TCPA-compliant).
