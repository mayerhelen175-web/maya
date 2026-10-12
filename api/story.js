// Maya — story generation endpoint (Vercel serverless function, Node 18+).
//
// POST /api/story with structured choices only (no names, no free text).
// Pipeline: validate input -> generate (LLM) -> deterministic checks -> moderator (LLM)
// -> up to 2 retries -> 422 { fallback: true } so the site shows a pre-approved story.
//
// The hero's real name never reaches this server: the model writes {HERO} and the
// browser substitutes the name on the device.
//
// Env:
//   ANTHROPIC_API_KEY        required
//   MAYA_STORY_MODEL         default "claude-sonnet-5-5"
//   MAYA_MODERATOR_MODEL     default "claude-haiku-5-5"
//   MAYA_ALLOWED_ORIGIN      default "*" (set to your site origin in production)
//   MAYA_RATE_PER_HOUR       default 12 stories per IP per hour

'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const STORY_MODEL = process.env.MAYA_STORY_MODEL || 'claude-sonnet-5-5';
const MOD_MODEL = process.env.MAYA_MODERATOR_MODEL || 'claude-haiku-5-5';
const MAX_ATTEMPTS = 3; // first try + 2 retries

const LANGS = { en: 'English', es: 'Spanish (US, neutral Latin American)', ru: 'Russian' };
const TOPICS = {
  fears: ['The dark', 'Doctor visits', 'Monsters under the bed', 'Starting preschool'],
  skills: ['Brushing teeth', 'Potty time', 'Tidying toys', 'Sleeping in own bed'],
  feels: ['Big anger', 'A new baby at home', 'Losing a game', 'Sharing']
};
const FAMILY = ['Mom', 'Dad', 'Grandma', 'Grandpa', 'Brother', 'Sister', 'Pet'];
const PRONOUNS = { she: 'she/her', he: 'he/him', they: 'they/them' };
const MOODS = {
  night: 'Bedtime: slow, soft rhythm, calming toward the end; the hero falls asleep peacefully at the end.',
  day: 'Daytime: warm, playful, gentle humor; good for practicing a skill.',
  sos: 'SOS: short (about 60% of normal length), bright and lively, meant to switch the moment; no scary beats.'
};
const LENGTH = { 2: '25-45 words per page, very short sentences, repetition, sound words', 3: '25-45 words per page, very short sentences, repetition', 4: '40-70 words per page', 5: '40-70 words per page', 6: '60-100 words per page', 7: '60-100 words per page' };

// ---------- input ----------
function validate(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const age = parseInt(b.age, 10);
  if (!(age >= 2 && age <= 7)) errors.push('age');
  if (!PRONOUNS[b.pron]) errors.push('pron');
  if (!TOPICS[b.cat]) errors.push('cat');
  else if (TOPICS[b.cat].indexOf(b.topic) < 0) errors.push('topic');
  if (!MOODS[b.mood]) errors.push('mood');
  const langs = Array.isArray(b.langs) ? b.langs.filter((l) => LANGS[l]) : [];
  if (langs.length < 1 || langs.length > 2 || new Set(langs).size !== langs.length) errors.push('langs');
  const family = Array.isArray(b.family) ? b.family.filter((f) => FAMILY.indexOf(f) >= 0) : [];
  if (errors.length) return { ok: false, errors };
  return { ok: true, input: { age, pron: b.pron, cat: b.cat, topic: b.topic, mood: b.mood, langs, family: Array.from(new Set(family)) } };
}

// ---------- prompts ----------
function storySystem() {
  return [
    'You write gentle, original picture-book stories for children aged 2 to 7, for parents in the United States.',
    'The child is the hero. The story helps with one worry, skill or feeling, and the hero solves it through their own small action.',
    '',
    'STRUCTURE: exactly 4 pages.',
    '1. The hero in a cozy, familiar world; a hint of the difficulty.',
    '2. The difficulty arrives. Name the feeling in simple words.',
    '3. Lumi, a tiny glowing firefly (an original character; she/her), offers a hint or a small tool, not the solution.',
    '4. The hero acts on their own; the difficulty gets smaller. End with a simple ritual the child can repeat in real life.',
    '',
    'HERO: never invent a name. Write the placeholder {HERO} wherever the name goes, in every language. Use the given pronouns consistently.',
    'FAMILY: mention only the family members listed. If none are listed, mention no family members. Never invent parents, siblings or pets.',
    'WORLD: keep every object and place consistent across pages.',
    '',
    'NEVER INCLUDE: death, dying, loss, grief, illness, injury, blood, hospitals as a setting, violence, weapons, punishment, shaming, threats,',
    'a parent leaving or not coming back, scary monsters that are real, dangerous imitable actions (hiding from adults, leaving home, fire, windows,',
    'climbing furniture, water play without an adult, outlets, medicine, eating unknown things, going with strangers),',
    'medical or diagnostic claims, religion unless asked, brand names, or characters, songs or places from existing books, films or games.',
    'Separation stories: the grown-up always comes back. Skills stories: the hero has one small slip and grown-ups respond calmly, with no shame.',
    'Do not lecture. Show the lesson through what the hero does.',
    '',
    'LANGUAGES: write each page natively in every requested language (not word-for-word translation). Keep meaning aligned page by page.',
    '',
    'OUTPUT: only JSON, no commentary:',
    '{"title": "<title in the first language, with {HERO}>", "pages": [{"<lang>": "<text>", ...} x4], "ritual": "<one simple action, first language>", "parent_tip": "<1-2 sentences for the parent, first language>"}'
  ].join('\n');
}
function storyUser(inp) {
  const langs = inp.langs.map((l) => `"${l}" = ${LANGS[l]}`).join(', ');
  return [
    `Age: ${inp.age}. Length: ${LENGTH[inp.age]}.`,
    `Hero pronouns: ${PRONOUNS[inp.pron]}.`,
    `Family members who may appear: ${inp.family.length ? inp.family.join(', ') : 'none'}.`,
    `Category: ${inp.cat}. The story helps with: ${inp.topic}.`,
    `Mood: ${MOODS[inp.mood]}`,
    `Languages (page keys): ${langs}. The first one is the main language.`
  ].join('\n');
}
function modSystem() {
  return [
    'You are a strict safety reviewer for AI-written stories for children aged 2-7. Review the JSON story you are given.',
    'Fail it if ANY of these is present in ANY language:',
    '- death, dying, grief, illness, injury, blood, violence, weapons, punishment, shaming, threats, frightening content beyond mild and resolved;',
    '- a parent or caregiver leaving or not returning;',
    '- dangerous actions a child could copy (hiding from adults, leaving home, fire, windows, climbing furniture, water without an adult, outlets, medicine, unknown food, strangers);',
    '- medical, diagnostic or therapy claims;',
    '- brand names or characters from existing media;',
    '- a real name instead of the {HERO} placeholder, or the hero never mentioned;',
    '- family members not in the allowed list;',
    '- contradictions between pages, or language versions that say different things;',
    '- anything sexual, romantic, political or religious;',
    '- not exactly 4 pages.',
    'Return only JSON: {"pass": true|false, "issues": ["short reason", ...]}'
  ].join('\n');
}

// ---------- deterministic checks ----------
const BANNED = /\b(die|dies|died|dying|dead|death|kill\w*|blood\w*|gun|guns|knife|knives|funeral|grave|cancer|sick|illness|hospital|ghost|monster attack|muere|muerte|muerto|sangre|matar|pistola|cuchillo|hospital|умер\w*|смерт\w*|кров\w*|убил\w*)\b/i;
const BRANDS = /(disney|pixar|dreamworks|marvel|elsa|frozen|peppa|paw patrol|bluey|pok[eé]mon|spider-?man|mickey|minnie|barbie|lego|sesame|cocomelon)/i;
const RELATIVES = {
  Mom: /\b(mom|mommy|mother|mama|mamá|maмa|мама|мамочка)\b/i,
  Dad: /\b(dad|daddy|father|papa|papá|папа)\b/i,
  Grandma: /\b(grandma|granny|grandmother|abuela|abuelita|бабушка)\b/i,
  Grandpa: /\b(grandpa|grandfather|abuelo|abuelito|дедушка)\b/i,
  Brother: /\b(brother|hermano|hermanito|брат\w*)\b/i,
  Sister: /\b(sister|hermana|hermanita|сестр\w*)\b/i
};
function staticCheck(story, inp) {
  const issues = [];
  if (!story || typeof story.title !== 'string' || !Array.isArray(story.pages)) return ['malformed'];
  if (story.pages.length !== 4) issues.push('page count');
  const texts = [story.title, story.ritual || '', story.parent_tip || ''];
  story.pages.forEach((p, i) => {
    inp.langs.forEach((l) => {
      if (!p || typeof p[l] !== 'string' || !p[l].trim()) issues.push(`page ${i + 1} missing ${l}`);
      else texts.push(p[l]);
    });
  });
  const childText = texts.slice(0, 1).concat(story.pages.map((p) => inp.langs.map((l) => (p && p[l]) || '').join(' '))).join(' ');
  if (!/\{HERO\}/.test(childText)) issues.push('no {HERO} placeholder');
  if (BANNED.test(childText)) issues.push('banned word');
  if (BRANDS.test(texts.join(' '))) issues.push('brand or known character');
  Object.keys(RELATIVES).forEach((rel) => {
    if (inp.family.indexOf(rel) < 0 && RELATIVES[rel].test(childText)) issues.push(`unlisted relative: ${rel}`);
  });
  return issues;
}

// ---------- LLM ----------
async function callClaude(model, system, user, maxTokens, fetchImpl) {
  const res = await (fetchImpl || fetch)(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return parseJson(text);
}
function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no json');
  return JSON.parse(s.slice(a, b + 1));
}

async function makeStory(inp, fetchImpl) {
  const log = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let story;
    try {
      story = await callClaude(STORY_MODEL, storySystem(), storyUser(inp), 2000, fetchImpl);
    } catch (e) { log.push({ attempt, stage: 'generate', issue: e.message }); continue; }
    const issues = staticCheck(story, inp);
    if (issues.length) { log.push({ attempt, stage: 'static', issues }); continue; }
    let verdict;
    try {
      verdict = await callClaude(MOD_MODEL, modSystem(), `Allowed family members: ${inp.family.join(', ') || 'none'}.\nRequested languages: ${inp.langs.join(', ')}.\nStory JSON:\n${JSON.stringify(story)}`, 400, fetchImpl);
    } catch (e) { log.push({ attempt, stage: 'moderate', issue: e.message }); continue; }
    if (verdict && verdict.pass === true) {
      return { ok: true, story: { title: story.title, langs: inp.langs, pages: story.pages.map((p) => inp.langs.map((l) => p[l])), ritual: story.ritual || '', parent_tip: story.parent_tip || '' }, attempts: attempt, log };
    }
    log.push({ attempt, stage: 'moderator', issues: (verdict && verdict.issues) || ['rejected'] });
  }
  return { ok: false, log };
}

// ---------- simple per-IP rate limit (per warm instance; use a shared store in production) ----------
const RATE_MAX = parseInt(process.env.MAYA_RATE_PER_HOUR || '12', 10);
const hits = new Map();
function limited(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}

// ---------- handler ----------
async function handler(req, res) {
  const origin = process.env.MAYA_ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { fallback: true, error: 'not configured' });

  const ip = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return send(res, 429, { fallback: true, error: 'slow down' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const v = validate(body);
  if (!v.ok) return send(res, 400, { error: 'invalid input', fields: v.errors });

  const out = await makeStory(v.input);
  // Moderation log is kept server-side (stdout) for the safety audit trail; no personal data in it.
  console.log(JSON.stringify({ event: 'story', ok: out.ok, input: v.input, log: out.log }));
  if (!out.ok) return send(res, 422, { fallback: true });
  return send(res, 200, out.story);
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

module.exports = handler;
module.exports._internal = { limited, validate, staticCheck, makeStory, storySystem, storyUser, parseJson };
