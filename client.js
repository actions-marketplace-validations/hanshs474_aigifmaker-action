// AI GIF Maker HTTP client (https://aigifmaker.ai). Plain node 20, no dependencies.
'use strict';

const BASE = 'https://aigifmaker.ai';
const KEYS_URL = `${BASE}/settings/apikeys`;
const PRICING_URL = `${BASE}/pricing`;

class AigifmakerError extends Error {
  constructor(message, { kind = 'api', code } = {}) {
    super(message);
    this.name = 'AigifmakerError';
    this.kind = kind; // auth | quota | rejected | failed | timeout | api
    this.code = code;
  }
}
class AuthError extends AigifmakerError {
  constructor(message, code) { super(message, { kind: 'auth', code }); this.name = 'AuthError'; }
}
class QuotaError extends AigifmakerError {
  constructor(message, code) { super(message, { kind: 'quota', code }); this.name = 'QuotaError'; }
}
class RejectedError extends AigifmakerError {
  constructor(message, code) { super(message, { kind: 'rejected', code }); this.name = 'RejectedError'; }
}

/** Map a JSON answer to its data, or throw the error that says what to do next. Every answer is HTTP 200. */
function unwrap(status, body) {
  if (!body || typeof body.code !== 'number') {
    throw new AigifmakerError((body && body.message) || `unexpected answer (HTTP ${status})`, { kind: 'api' });
  }
  if (body.code !== 0) {
    const msg = body.message || `request refused (code ${body.code})`;
    if (/invalid api key|no auth/i.test(msg)) throw new AuthError(msg, body.code);
    if (/insufficient credits/i.test(msg)) throw new QuotaError(/\/pricing/.test(msg) ? msg : `${msg}; top up at ${PRICING_URL}`, body.code);
    if (body.code !== -1) throw new RejectedError(msg, body.code);
    throw new AigifmakerError(msg, { code: body.code });
  }
  const data = body.data || {};
  if (data.wall === true) throw new AuthError(`an API key is required; create one at ${KEYS_URL} and pass it as the api-key input from a secret`, 0);
  return data;
}

class Aigifmaker {
  constructor({ apiKey = process.env.AIGIFMAKER_API_KEY, baseUrl = BASE, fetch: f = globalThis.fetch } = {}) {
    this.key = String(apiKey || '').trim();
    this.base = String(baseUrl).replace(/\/+$/, '');
    this.fetch = f;
  }

  async post(path, payload) {
    const headers = { 'content-type': 'application/json', 'user-agent': 'aigifmaker-action/1.0.0' };
    // Without a key the request still goes out: the service answers with a wall, which becomes an AuthError.
    if (this.key) headers.authorization = `Bearer ${this.key}`;
    const res = await this.fetch(`${this.base}${path}`, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    return unwrap(res.status, body);
  }

  async credits() {
    const d = await this.post('/api/user/get-user-credits', {});
    if (typeof d.remainingCredits !== 'number') throw new AigifmakerError('the service returned no credit balance');
    return d.remainingCredits;
  }

  async submit(prompt) {
    if (!String(prompt || '').trim()) throw new AigifmakerError('prompt is required', { kind: 'validation' });
    const d = await this.post('/api/ai/generate', {
      provider: 'openlux', mediaType: 'image', model: 'gif-maker-v1', scene: 'text-to-image',
      prompt, options: { output_format: 'gif' },
    });
    if (!d.id) throw new AigifmakerError('the service returned no task id');
    return String(d.id);
  }

  async status(id) { return this.post('/api/ai/query', { taskId: id }); }

  /** Poll a GIF every pollMs until it is ready; resolve to its URL. Queued GIFs report processing; keep waiting. */
  async wait(id, { timeoutMs = 5 * 60_000, pollMs = 3_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let d = null;
      try { d = await this.status(id); } catch (e) {
        // a dropped poll (network blip, non-JSON 5xx page) is not a failed GIF; a refusal is final
        const transient = !(e instanceof AigifmakerError) || (e.kind === 'api' && e.code === undefined);
        if (!transient) throw e;
      }
      if (d) {
        if (d.status === 'success' && Array.isArray(d.images) && d.images[0]) return d.images[0];
        if (d.status === 'failed' || d.status === 'canceled') {
          const why = d.errorMessage || d.status;
          if (d.failureKind === 'moderation') throw new RejectedError(`GIF ${id} was refused: ${why}`);
          throw new AigifmakerError(`GIF ${id} failed: ${why}`, { kind: 'failed' });
        }
      }
      if (Date.now() + pollMs >= deadline) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new AigifmakerError(`GIF ${id} did not finish in time; it may still land in your AI GIF Maker history`, { kind: 'timeout' });
  }

  async generate(prompt, opts) { return this.wait(await this.submit(prompt), opts); }
}

module.exports = { Aigifmaker, AigifmakerError, AuthError, QuotaError, RejectedError, unwrap, BASE, KEYS_URL, PRICING_URL };
