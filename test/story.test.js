'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.ANTHROPIC_API_KEY = 'test';
const handler = require('../api/story.js');
const { validate, staticCheck, makeStory, limited } = handler._internal;

const input = { age: 4, pron: 'she', cat: 'fears', topic: 'The dark', mood: 'night', langs: ['en', 'es'], family: ['Mom'] };
const good = {
  title: '{HERO} and the Little Light',
  pages: [
    { en: '{HERO} saw a soft glow. Lumi the firefly blinked hello.', es: '{HERO} vio una luz suave. Lumi, la luciérnaga, parpadeó hola.' },
    { en: 'Lumi showed how the dark is just the day resting.', es: 'Lumi mostró que la oscuridad es el día descansando.' },
    { en: 'Mom tucked the blanket in, warm and cozy.', es: 'Mamá arropó la manta, tibia y suave.' },
    { en: '{HERO} took three slow breaths and smiled. Good night.', es: '{HERO} respiró tres veces despacio y sonrió. Buenas noches.' }
  ],
  ritual: 'Three slow breaths with a night light.',
  parent_tip: 'Keep the light warm and dim.'
};
const bad = JSON.parse(JSON.stringify(good));
bad.pages[2].en = 'Dad tucked the blanket in.'; // unlisted relative

function mockFetch(replies) {
  let i = 0;
  const f = async () => {
    const text = replies[Math.min(i++, replies.length - 1)];
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }] }) };
  };
  f.calls = () => i;
  return f;
}

test('validate accepts allowlisted input and rejects free text', () => {
  assert.equal(validate(input).ok, true);
  assert.equal(validate({ ...input, topic: 'My dog Rex died' }).ok, false);
  assert.equal(validate({ ...input, langs: ['en', 'fr'] }).ok, true); // fr filtered out
  assert.equal(validate({ ...input, langs: ['fr'] }).ok, false);
  assert.equal(validate({ ...input, age: 12 }).ok, false);
});

test('static check catches unlisted relatives, missing {HERO} and banned words', () => {
  assert.deepEqual(staticCheck(good, input), []);
  assert.ok(staticCheck(bad, input).some((x) => /relative/.test(x)));
  const noHero = JSON.parse(JSON.stringify(good)); noHero.pages.forEach((p) => { p.en = p.en.replace(/\{HERO\}/g, 'Mila'); p.es = p.es.replace(/\{HERO\}/g, 'Mila'); }); noHero.title = 'Night';
  assert.ok(staticCheck(noHero, input).length > 0);
  const scary = JSON.parse(JSON.stringify(good)); scary.pages[1].en = 'There was blood on the floor.';
  assert.ok(staticCheck(scary, input).length > 0);
});

test('pass on first try returns paired pages', async () => {
  const f = mockFetch([good, { pass: true, issues: [] }]);
  const out = await makeStory(input, f);
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 1);
  assert.deepEqual(out.story.langs, ['en', 'es']);
  assert.equal(out.story.pages.length, 4);
  assert.equal(out.story.pages[0].length, 2);
});

test('static failure triggers a retry', async () => {
  const f = mockFetch([bad, good, { pass: true, issues: [] }]);
  const out = await makeStory(input, f);
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 2);
});

test('moderator rejecting every time falls back after 3 attempts', async () => {
  const replies = [];
  for (let k = 0; k < 3; k++) replies.push(good, { pass: false, issues: ['too scary'] });
  const f = mockFetch(replies);
  const out = await makeStory(input, f);
  assert.equal(out.ok, false);
  assert.equal(f.calls(), 6);
});

test('rate limit kicks in', () => {
  const t = Date.now();
  let blocked = false;
  for (let k = 0; k < 20; k++) blocked = limited('1.2.3.4', t) || blocked;
  assert.equal(blocked, true);
  assert.equal(limited('5.6.7.8', t), false);
});
