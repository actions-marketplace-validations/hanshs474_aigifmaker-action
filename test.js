// node test.js: offline tests against a fake fetch (real response shapes). node test.js --live adds the two free live checks.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Aigifmaker, AigifmakerError, AuthError, QuotaError, RejectedError } = require('./client');

const GIF = 'https://cdn.aigifmaker.ai/g/task_1.gif';
const SUBMITTED = { code: 0, message: 'ok', data: { id: 'task_1', status: 'pending', taskId: 'up_9', provider: 'openlux' } };
const ok = (data) => ({ code: 0, message: 'ok', data });

function fake(answers, calls = []) {
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    const a = typeof answers === 'function' ? answers(url) : answers.length > 1 ? answers.shift() : answers[0];
    return { status: 200, json: async () => a };
  };
  return f;
}
const client = (answers, calls, apiKey = 'sk-test') => new Aigifmaker({ apiKey, baseUrl: 'https://t', fetch: fake(answers, calls) });

async function offline() {
  // success: pending -> processing -> success; fixed body; query by data.id
  let calls = [];
  let polls = [ok({ id: 'task_1', status: 'processing', images: [] }), ok({ id: 'task_1', status: 'success', images: [GIF], watermarked: [false] })];
  let c = client((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED : polls.length > 1 ? polls.shift() : polls[0]), calls);
  assert.strictEqual(await c.generate('a cat waving hello', { pollMs: 1 }), GIF);
  assert.deepStrictEqual(calls[0], {
    url: 'https://t/api/ai/generate', auth: 'Bearer sk-test',
    body: { provider: 'openlux', mediaType: 'image', model: 'gif-maker-v1', scene: 'text-to-image', prompt: 'a cat waving hello', options: { output_format: 'gif' } },
  });
  assert.deepStrictEqual(calls[1].body, { taskId: 'task_1' });
  assert.strictEqual(calls[1].url, 'https://t/api/ai/query');
  assert.strictEqual(calls.length, 3);

  // queued keeps polling
  polls = [ok({ id: 'task_1', status: 'processing', images: [], queued: true, queueEta: 40 }),
    ok({ id: 'task_1', status: 'processing', images: [], queued: true, queueEta: 5 }),
    ok({ id: 'task_1', status: 'success', images: [GIF], watermarked: [true] })];
  c = client((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED : polls.length > 1 ? polls.shift() : polls[0]));
  const id = await c.submit('x');
  assert.strictEqual(id, 'task_1');
  const s = await c.status(id);
  assert.ok(s.queued && s.queueEta === 40 && s.status === 'processing');
  assert.strictEqual(await c.wait(id, { pollMs: 1 }), GIF);

  // failed / moderation
  c = client((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED
    : ok({ id: 'task_1', status: 'failed', images: [], errorMessage: 'upstream returned a still image', refundNote: 'credit refunded' })));
  await assert.rejects(c.generate('x', { pollMs: 1 }), (e) => e.kind === 'failed' && /still image/.test(e.message));
  c = client((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED
    : ok({ id: 'task_1', status: 'failed', images: [], errorMessage: 'blocked', failureKind: 'moderation' })));
  await assert.rejects(c.generate('x', { pollMs: 1 }), (e) => e instanceof RejectedError);

  // invalid key / no auth
  const invalid = { code: -1, message: 'invalid API key — create one at https://aigifmaker.ai/settings/apikeys' };
  await assert.rejects(client([invalid], [], 'sk-bad').credits(), (e) => e instanceof AuthError);
  await assert.rejects(client([invalid], [], 'sk-bad').submit('x'), (e) => e instanceof AuthError);
  await assert.rejects(client([{ code: -1, message: 'no auth' }]).status('t'), (e) => e instanceof AuthError);

  // wall: no key, no Authorization header, AuthError
  calls = [];
  await assert.rejects(client([ok({ wall: true, reason: 'anon_credits', cost: 1, remaining: 0, grant: 0 })], calls, '').submit('x'),
    (e) => e instanceof AuthError && /settings\/apikeys/.test(e.message));
  assert.strictEqual(calls[0].auth, undefined);

  // insufficient credits, cooldown, other
  await assert.rejects(client([{ code: -1, message: 'insufficient credits' }]).submit('x'),
    (e) => e instanceof QuotaError && e.message.includes('https://aigifmaker.ai/pricing'));
  await assert.rejects(client([{ code: 429, message: 'please wait before trying again' }]).submit('x'), (e) => e instanceof RejectedError);
  await assert.rejects(client([{ code: -1, message: 'prompt too long' }]).submit('x'),
    (e) => e.constructor === AigifmakerError && e.message === 'prompt too long');

  // credits, timeout, empty prompt
  calls = [];
  assert.strictEqual(await client([ok({ remainingCredits: 42, made: 3 })], calls).credits(), 42);
  assert.strictEqual(calls[0].url, 'https://t/api/user/get-user-credits');
  c = client((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED : ok({ id: 'task_1', status: 'processing' })));
  await assert.rejects(c.generate('x', { timeoutMs: 30, pollMs: 5 }), (e) => e.kind === 'timeout');
  await assert.rejects(client([SUBMITTED]).submit(' '), (e) => e.kind === 'validation');

  // the action end to end: inputs in, gif-url out
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aigif-')), 'out.txt');
  Object.assign(process.env, { INPUT_PROMPT: 'a cat waving hello', 'INPUT_API-KEY': 'sk-test', 'INPUT_TIMEOUT-MINUTES': '1', GITHUB_OUTPUT: out });
  calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake((u) => (u.endsWith('/api/ai/generate') ? SUBMITTED : ok({ id: 'task_1', status: 'success', images: [GIF] })), calls);
  const log = console.log;
  console.log = () => {};
  try { await require('./index').main(); } finally { globalThis.fetch = realFetch; console.log = log; }
  assert.ok(fs.readFileSync(out, 'utf8').includes(`gif-url=${GIF}`));
  assert.strictEqual(calls[0].auth, 'Bearer sk-test');
  console.log('offline tests ok');
}

async function live() {
  await assert.rejects(new Aigifmaker({ apiKey: 'sk-invalidtest000' }).credits(), (e) => e instanceof AuthError);
  console.log('live ok: wrong key -> AuthError');
  await assert.rejects(new Aigifmaker({ apiKey: '' }).submit('a cat waving hello'), (e) => e instanceof AuthError);
  console.log('live ok: no key -> AuthError (wall)');
}

(async () => {
  await offline();
  if (process.argv.includes('--live')) await live();
})().catch((e) => { console.error(e); process.exit(1); });
