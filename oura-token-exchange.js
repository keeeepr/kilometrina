/**
 * Kilometrina — Cloudflare Worker: Oura OAuth2 token exchange + API relay,
 * and meal photo estimates from Claude (POST /meal).
 *
 * Why this exists: Oura retired Personal Access Tokens, so the only way in is
 * OAuth2 — and Oura's token endpoint requires client_secret. A secret cannot
 * live in index.html, because GitHub Pages serves that file to anyone. This
 * Worker is the one place that holds the secret: the page sends it an
 * authorization code, the Worker trades it for tokens, the page gets tokens.
 *
 * It also relays the page's data requests (GET /api/<collection>) to Oura's
 * API, because Oura's API does not answer browser requests from other sites
 * (CORS). The page's own access token is passed through; nothing is added.
 *
 * POST /meal sends a meal photo (and/or a description) to Claude and returns
 * calories and macros. The Anthropic API key lives here as a secret; because
 * that key costs money, the route also requires APP_PASSCODE, which the page
 * asks for once and keeps in the browser.
 *
 * It stores nothing and logs nothing. It is a relay, not a backend.
 *
 * ---- Deploy (details in README.md) ----------------------------------------
 *   npm install            (once — pulls in @anthropic-ai/sdk)
 *   npx wrangler deploy    (settings in wrangler.toml)
 *   npx wrangler secret put OURA_CLIENT_ID
 *   npx wrangler secret put OURA_CLIENT_SECRET
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler secret put APP_PASSCODE
 *
 * ALLOWED_ORIGIN is the exact origin of the hosted page (scheme + host, no
 * path, no trailing slash). Several may be comma-separated, which is handy
 * while testing from http://localhost:8000. If it is unset, this Worker
 * refuses every request rather than accepting calls from anywhere.
 * ------------------------------------------------------------------------
 */

import Anthropic from '@anthropic-ai/sdk';

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_API_URL = 'https://api.ouraring.com/v2/usercollection/';
// Only what Kilometrina reads — the relay is not a general Oura proxy.
const OURA_COLLECTIONS = ['daily_sleep', 'daily_readiness', 'daily_activity', 'sleep', 'heartrate'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Passcode',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
      origin ? corsHeaders(origin) : {}
    )
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** Ask Oura for tokens. Shared by both grant types — only the form differs. */
async function requestOuraTokens(form, env) {
  form.set('client_id', env.OURA_CLIENT_ID);
  form.set('client_secret', env.OURA_CLIENT_SECRET);

  const res = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: form.toString()
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { data = { error: 'oura_unparseable_response', error_description: text.slice(0, 300) }; }

  return { ok: res.ok, status: res.status, data: data };
}

/** GET /api/<collection>?… → Oura API, with the caller's own Bearer token. */
async function relayOuraApi(request, url, origin) {
  const collection = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  if (OURA_COLLECTIONS.indexOf(collection) === -1) {
    return jsonResponse({ error: 'not_found', error_description: 'Unknown collection' }, 404, origin);
  }
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) {
    return jsonResponse({ error: 'missing_token' }, 401, origin);
  }
  let res;
  try {
    res = await fetch(OURA_API_URL + collection + url.search, {
      headers: { 'Authorization': auth, 'Accept': 'application/json' }
    });
  } catch (e) {
    return jsonResponse({ error: 'oura_unreachable', error_description: String(e && e.message || e) }, 502, origin);
  }
  // Status and body pass through unchanged, so the page's 401 → refresh logic still works.
  return new Response(res.body, {
    status: res.status,
    headers: Object.assign(
      { 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
      corsHeaders(origin)
    )
  });
}

// ---------- POST /meal: photo / description → calories and macros ----------

const MEAL_MODEL = 'claude-opus-5';
const MAX_IMAGE_BASE64 = 4 * 1024 * 1024; // the page sends ~1024px JPEGs, far below this

const MEAL_SYSTEM_PROMPT = `You estimate the nutrition of meals for a personal food diary. The user sends a photo of food or a drink, a short description, or both. The user is Slovenian: write "name" and "notes" in Slovenian.

Identify what is there, judge the portion size from the visual cues (plate, cutlery, packaging, hands) or from the description, and estimate the total for everything shown or described:
- name: a short title, at most 4 words, naming the main dish only (e.g. "Losos z rižem", "Ovseni kosmiči z jagodami").
- calories: total kilocalories, as a whole number.
- protein_g, carbs_g, fat_g: grams for the whole portion.
- confidence: "high" when the food and portion are clear, "low" when you are mostly guessing (hidden ingredients, unclear portion, sauces).
- notes: one short sentence naming the biggest assumption you made (e.g. "Predpostavljena 1 skodelica kuhanega riža.").

When a description is given, it overrides what the photo suggests (e.g. stated grams, "brez omake"). If several items are present, sum them into one meal. If there is no food or drink, set is_food to false and use 0 and empty strings for the rest.`;

// Structured outputs: Claude's reply is guaranteed to match this shape.
const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean' },
    name: { type: 'string' },
    calories: { type: 'integer' },
    protein_g: { type: 'number' },
    carbs_g: { type: 'number' },
    fat_g: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' }
  },
  required: ['is_food', 'name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'notes'],
  additionalProperties: false
};

/** Constant-time compare, so the passcode can't be guessed from response timing. */
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function estimateMeal(request, env, origin) {
  if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE) {
    return jsonResponse({ error: 'worker_not_configured', error_description: 'ANTHROPIC_API_KEY / APP_PASSCODE secrets are missing on this Worker.' }, 500, origin);
  }
  if (!sameSecret(request.headers.get('X-App-Passcode') || '', env.APP_PASSCODE)) {
    return jsonResponse({ error: 'bad_passcode', error_description: 'Napačno geslo za AI analizo.' }, 401, origin);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return jsonResponse({ error: 'invalid_json' }, 400, origin); }

  const image = typeof body.image === 'string' ? body.image : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
  if (!image && !description) {
    return jsonResponse({ error: 'missing_parameters', error_description: 'Pošlji sliko ali opis obroka.' }, 400, origin);
  }
  if (image.length > MAX_IMAGE_BASE64) {
    return jsonResponse({ error: 'image_too_large' }, 413, origin);
  }

  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  content.push({
    type: 'text',
    text: description
      ? 'Estimate the calories and macros for this meal. Description from the user: ' + description
      : 'Estimate the calories and macros for this meal.'
  });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MEAL_MODEL,
      max_tokens: 2000,
      // Photo → JSON is routine extraction; low effort keeps it fast and cheap.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: MEAL_SCHEMA } },
      // If the safety classifiers decline, re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: MEAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: content }]
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return jsonResponse({ error: 'anthropic_auth', error_description: 'Claude API ključ na Workerju ni veljaven.' }, 502, origin);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return jsonResponse({ error: 'rate_limited', error_description: 'Preveč zahtev naenkrat. Poskusi čez minuto.' }, 429, origin);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return jsonResponse({ error: 'anthropic_unreachable', error_description: 'Claude trenutno ni dosegljiv. Poskusi znova.' }, 502, origin);
    }
    if (error instanceof Anthropic.APIError) {
      return jsonResponse({ error: 'anthropic_error', error_description: 'Claude je vrnil napako (' + error.status + ').' }, 502, origin);
    }
    return jsonResponse({ error: 'worker_error', error_description: String(error && error.message || error) }, 500, origin);
  }

  if (response.stop_reason === 'refusal') {
    return jsonResponse({ error: 'refused', error_description: 'Claude te slike ni analiziral. Vnesi obrok ročno.' }, 422, origin);
  }
  if (response.stop_reason === 'max_tokens') {
    return jsonResponse({ error: 'truncated', error_description: 'Analiza je bila prekinjena. Poskusi znova.' }, 502, origin);
  }
  const text = response.content.find((b) => b.type === 'text');
  let estimate;
  try { estimate = JSON.parse(text ? text.text : ''); }
  catch (e) { return jsonResponse({ error: 'unreadable', error_description: 'Odgovor ni bil berljiv. Poskusi znova.' }, 502, origin); }
  if (estimate.is_food === false) {
    return jsonResponse({ error: 'not_food', error_description: 'Na sliki ni hrane. Poskusi z drugo sliko ali vnesi ročno.' }, 422, origin);
  }

  const n = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : 0);
  return jsonResponse({
    name: String(estimate.name || '').trim().slice(0, 60),
    calories: n(estimate.calories),
    protein: n(estimate.protein_g),
    carbs: n(estimate.carbs_g),
    fat: n(estimate.fat_g),
    confidence: ['low', 'medium', 'high'].indexOf(estimate.confidence) !== -1 ? estimate.confidence : 'medium',
    notes: String(estimate.notes || '').trim()
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
    const allowList = allowedOrigins(env);

    // Fail closed: no ALLOWED_ORIGIN configured means no requests served.
    if (!allowList.length) {
      return jsonResponse(
        { error: 'worker_not_configured',
          error_description: 'ALLOWED_ORIGIN is not set on this Worker. Redeploy with --var ALLOWED_ORIGIN:https://your-page-origin' },
        500, null
      );
    }
    if (!origin || allowList.indexOf(origin) === -1) {
      return jsonResponse(
        { error: 'origin_not_allowed',
          error_description: 'This Worker does not serve requests from that origin.' },
        403, null
      );
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
      return relayOuraApi(request, url, origin);
    }
    if (request.method === 'POST' && url.pathname.replace(/\/$/, '') === '/meal') {
      return estimateMeal(request, env, origin);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, origin);
    }
    if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
      return jsonResponse(
        { error: 'worker_not_configured',
          error_description: 'OURA_CLIENT_ID / OURA_CLIENT_SECRET secrets are missing on this Worker.' },
        500, origin
      );
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return jsonResponse({ error: 'invalid_json' }, 400, origin); }

    const path = new URL(request.url).pathname.replace(/\/$/, '');
    let form;

    if (path === '/exchange') {
      // Fresh sign-in: authorization code → access + refresh token.
      if (!body.code || !body.redirect_uri) {
        return jsonResponse({ error: 'missing_parameters', error_description: 'code and redirect_uri are required' }, 400, origin);
      }
      form = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(body.code),
        redirect_uri: String(body.redirect_uri)
      });
    } else if (path === '/refresh') {
      // Access token expired: refresh token → a new pair.
      if (!body.refresh_token) {
        return jsonResponse({ error: 'missing_parameters', error_description: 'refresh_token is required' }, 400, origin);
      }
      form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(body.refresh_token)
      });
    } else {
      return jsonResponse({ error: 'not_found', error_description: 'Use POST /exchange or POST /refresh' }, 404, origin);
    }

    let result;
    try {
      result = await requestOuraTokens(form, env);
    } catch (e) {
      return jsonResponse({ error: 'oura_unreachable', error_description: String(e && e.message || e) }, 502, origin);
    }

    if (!result.ok) {
      // Pass Oura's own error through, so the page can show something useful.
      return jsonResponse(
        { error: result.data.error || 'oura_error',
          error_description: result.data.error_description || ('Oura returned HTTP ' + result.status) },
        result.status === 401 ? 401 : 400, origin
      );
    }

    // Hand back only the token fields — nothing else needs to cross the wire.
    return jsonResponse({
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_in: result.data.expires_in,
      token_type: result.data.token_type
    }, 200, origin);
  }
};
