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
 * calories and macros; POST /supplement reads a supplement label photo into
 * product name, serving and ingredients per serving; POST /fitness reads a
 * coach's monthly fitness programme (PDF or photos) into structured JSON.
 * The Anthropic API key
 * lives here as a secret; because that key costs money, the AI routes need
 * both APP_PASSCODE and a live Google sign-in of ALLOWED_EMAIL (checked with
 * Google, and only for tokens issued to this app's GOOGLE_CLIENT_ID).
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
 *   npx wrangler secret put ALLOWED_EMAIL      (the one Google account allowed to use AI)
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Passcode, X-Google-Token',
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

// ---------- AI routes: POST /meal and POST /supplement ----------

const AI_MODEL = 'claude-opus-5';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const MAX_IMAGE_BASE64 = 4 * 1024 * 1024; // the page sends ~1024px JPEGs, far below this

const MEAL_SYSTEM_PROMPT = `You estimate the nutrition of meals for a personal food diary. The user sends a photo of food or a drink, a short description, or both. The user is Slovenian: write "name" and "notes" in Slovenian.

Identify what is there, judge the portion size from the visual cues (plate, cutlery, packaging, hands) or from the description, and estimate the total for everything shown or described:
- name: a short title, at most 4 words, naming the main dish only (e.g. "Losos z rižem", "Ovseni kosmiči z jagodami").
- calories: total kilocalories, as a whole number.
- protein_g, carbs_g, fat_g: grams for the whole portion.
- confidence: "high" when the food and portion are clear, "low" when you are mostly guessing (hidden ingredients, unclear portion, sauces).
- notes: one short sentence naming the biggest assumption you made (e.g. "Predpostavljena 1 skodelica kuhanega riža.").
- items: the recognizable components (at most 8, e.g. "Losos", "Riž", "Solata z olivnim oljem"), each with its own kcal, protein_g, carbs_g and fat_g, named in Slovenian. The item values should add up to the totals.

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
    notes: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kcal: { type: 'integer' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' }
        },
        required: ['name', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
        additionalProperties: false
      }
    }
  },
  required: ['is_food', 'name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'notes', 'items'],
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

/**
 * Gate shared by the AI routes: the passcode AND a live Google sign-in of the
 * owner. The page sends its Google access token; Google's tokeninfo tells us
 * which OAuth client it was issued to and for which account, so a leaked
 * passcode alone is not enough. Returns a Response to send, or null.
 */
async function aiAccessError(request, env, origin) {
  if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE || !env.ALLOWED_EMAIL || !env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'worker_not_configured', error_description: 'ANTHROPIC_API_KEY / APP_PASSCODE / ALLOWED_EMAIL / GOOGLE_CLIENT_ID are missing on this Worker.' }, 500, origin);
  }
  if (!sameSecret(request.headers.get('X-App-Passcode') || '', env.APP_PASSCODE)) {
    return jsonResponse({ error: 'bad_passcode', error_description: 'Napačno geslo za AI analizo.' }, 401, origin);
  }

  const token = request.headers.get('X-Google-Token') || '';
  if (!token) {
    return jsonResponse({ error: 'google_required', error_description: 'Za AI analizo se prijavi v Google.' }, 401, origin);
  }
  let info;
  try {
    const res = await fetch(GOOGLE_TOKENINFO_URL + '?access_token=' + encodeURIComponent(token));
    info = res.ok ? await res.json() : null;
  } catch (e) {
    return jsonResponse({ error: 'google_unreachable', error_description: 'Google prijave ni bilo mogoče preveriti. Poskusi znova.' }, 502, origin);
  }
  // No info = expired or revoked token.
  if (!info) {
    return jsonResponse({ error: 'google_required', error_description: 'Google prijava je potekla — prijavi se znova.' }, 401, origin);
  }
  const issuedToUs = info.aud === env.GOOGLE_CLIENT_ID || info.azp === env.GOOGLE_CLIENT_ID;
  const owner = String(info.email || '').toLowerCase() === String(env.ALLOWED_EMAIL).trim().toLowerCase()
    && String(info.email_verified) === 'true';
  if (!issuedToUs || !owner) {
    return jsonResponse({ error: 'google_not_allowed', error_description: 'Ta Google račun nima dostopa do AI analize.' }, 403, origin);
  }
  return null;
}

async function readAiBody(request, origin) {
  let body;
  try { body = await request.json(); }
  catch (e) { return { error: jsonResponse({ error: 'invalid_json' }, 400, origin) }; }
  const image = typeof body.image === 'string' ? body.image : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
  if (image.length > MAX_IMAGE_BASE64) return { error: jsonResponse({ error: 'image_too_large' }, 413, origin) };
  return { image: image, description: description };
}

/**
 * One structured-output request to Claude. Resolves to { data } with the
 * parsed JSON, or { error } holding a Response ready to send to the page.
 */
async function askClaudeJson(env, origin, system, schema, content, opts) {
  opts = opts || {};
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: opts.timeout || 60000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens || 4000,
      // Photo → JSON is routine extraction; low effort keeps it fast and cheap.
      output_config: { effort: opts.effort || 'low', format: { type: 'json_schema', schema: schema } },
      // If the safety classifiers decline, re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: system,
      messages: [{ role: 'user', content: content }]
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { error: jsonResponse({ error: 'anthropic_auth', error_description: 'Claude API ključ na Workerju ni veljaven.' }, 502, origin) };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { error: jsonResponse({ error: 'rate_limited', error_description: 'Preveč zahtev naenkrat. Poskusi čez minuto.' }, 429, origin) };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { error: jsonResponse({ error: 'anthropic_unreachable', error_description: 'Claude trenutno ni dosegljiv. Poskusi znova.' }, 502, origin) };
    }
    if (error instanceof Anthropic.APIError) {
      return { error: jsonResponse({ error: 'anthropic_error', error_description: 'Claude je vrnil napako (' + error.status + ').' }, 502, origin) };
    }
    return { error: jsonResponse({ error: 'worker_error', error_description: String(error && error.message || error) }, 500, origin) };
  }

  if (response.stop_reason === 'refusal') {
    return { error: jsonResponse({ error: 'refused', error_description: 'Claude te slike ni analiziral. Vnesi podatke ročno.' }, 422, origin) };
  }
  if (response.stop_reason === 'max_tokens') {
    return { error: jsonResponse({ error: 'truncated', error_description: 'Analiza je bila prekinjena. Poskusi znova.' }, 502, origin) };
  }
  const text = response.content.find((b) => b.type === 'text');
  try { return { data: JSON.parse(text ? text.text : '') }; }
  catch (e) { return { error: jsonResponse({ error: 'unreadable', error_description: 'Odgovor ni bil berljiv. Poskusi znova.' }, 502, origin) }; }
}

const imageBlock = (image) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
const wholeNumber = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : 0);

async function estimateMeal(request, env, origin) {
  const denied = await aiAccessError(request, env, origin);
  if (denied) return denied;
  const input = await readAiBody(request, origin);
  if (input.error) return input.error;
  if (!input.image && !input.description) {
    return jsonResponse({ error: 'missing_parameters', error_description: 'Pošlji sliko ali opis obroka.' }, 400, origin);
  }

  const content = [];
  if (input.image) content.push(imageBlock(input.image));
  content.push({
    type: 'text',
    text: input.description
      ? 'Estimate the calories and macros for this meal. Description from the user: ' + input.description
      : 'Estimate the calories and macros for this meal.'
  });

  const result = await askClaudeJson(env, origin, MEAL_SYSTEM_PROMPT, MEAL_SCHEMA, content);
  if (result.error) return result.error;
  const estimate = result.data;
  if (estimate.is_food === false) {
    return jsonResponse({ error: 'not_food', error_description: 'Na sliki ni hrane. Poskusi z drugo sliko ali vnesi ročno.' }, 422, origin);
  }
  return jsonResponse({
    name: String(estimate.name || '').trim().slice(0, 60),
    calories: wholeNumber(estimate.calories),
    protein: wholeNumber(estimate.protein_g),
    carbs: wholeNumber(estimate.carbs_g),
    fat: wholeNumber(estimate.fat_g),
    confidence: ['low', 'medium', 'high'].indexOf(estimate.confidence) !== -1 ? estimate.confidence : 'medium',
    notes: String(estimate.notes || '').trim(),
    items: (Array.isArray(estimate.items) ? estimate.items : []).slice(0, 8).map((i) => ({
      name: String(i.name || '').trim().slice(0, 40),
      kcal: wholeNumber(i.kcal),
      protein: wholeNumber(i.protein_g),
      carbs: wholeNumber(i.carbs_g),
      fat: wholeNumber(i.fat_g)
    })).filter((i) => i.name)
  }, 200, origin);
}

// ---------- POST /supplement: label photo → product and ingredients per serving ----------

const SUPPLEMENT_SYSTEM_PROMPT = `You read dietary supplement labels for a personal supplement log. The user sends a photo of a supplement package, bottle or label (possibly only part of it), a short description, or both. The user is Slovenian: write "name", "serving", ingredient names and "notes" in Slovenian (keep the brand as printed).

Read what the label states — do not guess amounts that are not printed:
- name: the product name as a short title (e.g. "Magnezij B6", "Vitamin D3 2000 IE", "Omega-3 ribje olje").
- brand: the manufacturer or brand, or "" if not visible.
- serving: the serving size the amounts refer to (e.g. "1 kapsula", "2 tableti", "5 ml"), or "" if not visible.
- ingredients: every active ingredient listed in the nutrition/supplement facts table with its amount PER SERVING. Use the common Slovenian name (e.g. "Magnezij", "Vitamin B6", "Vitamin D3", "EPA", "DHA", "Cink"). amount is the number, unit is exactly as printed ("mg", "µg", "g", "IE", "IU", "CFU", "ml"). nrv_percent is the % of the reference intake (%PV / %NRV / %RDA) if printed, otherwise 0. Leave out fillers and capsule materials (gelatin, magnesium stearate, colourings).
- confidence: "high" when the facts table is clearly readable, "low" when parts are cut off, blurry, or you had to infer.
- notes: one short sentence about anything important (e.g. "Tabela je delno zakrita — preveri količine." or the recommended daily dose if printed).

Without a photo, take the product and amounts from the description; if the user names a common product without amounts, use typical label values for it and set confidence to "low".
If there is no supplement in the photo or the description, set is_supplement to false and use empty values for the rest.`;

const SUPPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    is_supplement: { type: 'boolean' },
    name: { type: 'string' },
    brand: { type: 'string' },
    serving: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          unit: { type: 'string' },
          nrv_percent: { type: 'number' }
        },
        required: ['name', 'amount', 'unit', 'nrv_percent'],
        additionalProperties: false
      }
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' }
  },
  required: ['is_supplement', 'name', 'brand', 'serving', 'ingredients', 'confidence', 'notes'],
  additionalProperties: false
};

async function readSupplement(request, env, origin) {
  const denied = await aiAccessError(request, env, origin);
  if (denied) return denied;
  const input = await readAiBody(request, origin);
  if (input.error) return input.error;
  if (!input.image && !input.description) {
    return jsonResponse({ error: 'missing_parameters', error_description: 'Pošlji sliko etikete ali opis dopolnila.' }, 400, origin);
  }

  const content = [];
  if (input.image) content.push(imageBlock(input.image));
  content.push({
    type: 'text',
    text: input.image
      ? (input.description ? 'Read this supplement label. Note from the user: ' + input.description : 'Read this supplement label.')
      : 'Identify this supplement from the description: ' + input.description
  });
  const result = await askClaudeJson(env, origin, SUPPLEMENT_SYSTEM_PROMPT, SUPPLEMENT_SCHEMA, content);
  if (result.error) return result.error;
  const label = result.data;
  if (label.is_supplement === false) {
    return jsonResponse({ error: 'not_supplement', error_description: 'Na sliki ni etikete dopolnila. Poskusi z bolj jasno sliko.' }, 422, origin);
  }
  const positive = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : 0);
  return jsonResponse({
    name: String(label.name || '').trim().slice(0, 60),
    brand: String(label.brand || '').trim().slice(0, 60),
    serving: String(label.serving || '').trim().slice(0, 40),
    ingredients: (Array.isArray(label.ingredients) ? label.ingredients : []).slice(0, 40).map((i) => ({
      name: String(i.name || '').trim().slice(0, 40),
      amount: positive(i.amount),
      unit: String(i.unit || '').trim().slice(0, 10),
      nrv: positive(i.nrv_percent)
    })).filter((i) => i.name),
    confidence: ['low', 'medium', 'high'].indexOf(label.confidence) !== -1 ? label.confidence : 'medium',
    notes: String(label.notes || '').trim()
  }, 200, origin);
}

// ---------- POST /fitness: a coach's monthly programme → structured JSON ----------

const MAX_FITNESS_FILES = 6;
const MAX_FITNESS_BASE64 = 16 * 1024 * 1024; // all files together

const FITNESS_SYSTEM_PROMPT = `You transcribe a swimming federation fitness coach's monthly strength programme (one PDF or photos of it) into JSON for a training app. The athlete is Slovenian: keep all names, cues and notes in Slovenian exactly as written. Transcribe only — never invent, "improve" or complete values; if a cell is unreadable, use 0 or "" and mention it in "uncertain".

Typical layout: one block = one month; 1–2 sessions (Fitnes A / Fitnes B), each with a goal (e.g. "Razvoj maksimalne moči"); 4 microcycles ("mikrocikel", MC) with a number and start date (e.g. 42. MC, 15. jun); warm-up (~15 min); CORE with 2–3 exercises (duration and number of series); the main part: exercise, coach's note (cue), equipment, and for every week the sets as "% · kg × reps", "× reps" or seconds; per exercise and week the volume, 1RM and % intensity; stretching (~10 min); footer: volume, intensity, tempo, rest (may be supersets like "30 s / 180 s"), a Mon–Sun schedule.

Fields:
- title: the month and year (e.g. "Junij 2026"); place, coach: if printed, else "".
- weeks: the microcycles in order: mc (number), date (short, e.g. "15. 6.").
- sessions: id "A", "B", …; name (e.g. "Fitnes A"); goal; tempo; rest; warm_min; stretch_min; core (name, dose e.g. "30–35 s · 3 serije", series = number of series); week_totals (one per week, same order as weeks: volume e.g. "4.237 kg" and reps e.g. "120 pon", "" if not printed).
- exercises: name, cue (coach's note, "" if none), equip ("" if none), type "kg" when sets have a weight, "sec" when sets are durations, otherwise "reps"; weeks: one per microcycle in order, each with sets (percent, kg, reps, seconds — 0 when not applicable) and total (the printed volume/1RM/intensity line, e.g. "1.940 kg · 1RM 88 · 71 % int.", or "").
- schedule: for each week index (0-based) the training days as 0 = Monday … 6 = Sunday, only if marked in the document.
- uncertain: short notes (Slovenian) about anything you could not read with confidence.
If the document is not a training programme, set is_program to false and leave the rest empty.`;

const FITNESS_SCHEMA = {
  type: 'object',
  properties: {
    is_program: { type: 'boolean' },
    title: { type: 'string' },
    place: { type: 'string' },
    coach: { type: 'string' },
    weeks: { type: 'array', items: { type: 'object', properties: { mc: { type: 'integer' }, date: { type: 'string' } }, required: ['mc', 'date'], additionalProperties: false } },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, goal: { type: 'string' },
          tempo: { type: 'string' }, rest: { type: 'string' },
          warm_min: { type: 'integer' }, stretch_min: { type: 'integer' },
          core: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, dose: { type: 'string' }, series: { type: 'integer' } }, required: ['name', 'dose', 'series'], additionalProperties: false } },
          week_totals: { type: 'array', items: { type: 'object', properties: { volume: { type: 'string' }, reps: { type: 'string' } }, required: ['volume', 'reps'], additionalProperties: false } },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' }, cue: { type: 'string' }, equip: { type: 'string' },
                type: { type: 'string', enum: ['kg', 'reps', 'sec'] },
                weeks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sets: { type: 'array', items: { type: 'object', properties: { percent: { type: 'number' }, kg: { type: 'number' }, reps: { type: 'integer' }, seconds: { type: 'integer' } }, required: ['percent', 'kg', 'reps', 'seconds'], additionalProperties: false } },
                      total: { type: 'string' }
                    },
                    required: ['sets', 'total'],
                    additionalProperties: false
                  }
                }
              },
              required: ['name', 'cue', 'equip', 'type', 'weeks'],
              additionalProperties: false
            }
          }
        },
        required: ['id', 'name', 'goal', 'tempo', 'rest', 'warm_min', 'stretch_min', 'core', 'week_totals', 'exercises'],
        additionalProperties: false
      }
    },
    schedule: { type: 'array', items: { type: 'object', properties: { week_index: { type: 'integer' }, days: { type: 'array', items: { type: 'integer' } } }, required: ['week_index', 'days'], additionalProperties: false } },
    uncertain: { type: 'array', items: { type: 'string' } }
  },
  required: ['is_program', 'title', 'place', 'coach', 'weeks', 'sessions', 'schedule', 'uncertain'],
  additionalProperties: false
};

async function readFitnessProgram(request, env, origin) {
  const denied = await aiAccessError(request, env, origin);
  if (denied) return denied;
  let body;
  try { body = await request.json(); }
  catch (e) { return jsonResponse({ error: 'invalid_json' }, 400, origin); }
  const files = (Array.isArray(body.files) ? body.files : []).filter((f) => f && typeof f.data === 'string' && f.data)
    .slice(0, MAX_FITNESS_FILES);
  if (!files.length) {
    return jsonResponse({ error: 'missing_parameters', error_description: 'Naloži PDF ali sliko programa.' }, 400, origin);
  }
  if (files.reduce((a, f) => a + f.data.length, 0) > MAX_FITNESS_BASE64) {
    return jsonResponse({ error: 'too_large', error_description: 'Datoteke so prevelike (največ ~12 MB skupaj).' }, 413, origin);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const content = files.map((f) => (f.type === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    : imageBlock(f.data)));
  content.push({ type: 'text', text: 'Transcribe this fitness programme.' + (note ? ' Note from the athlete: ' + note : '') });

  const result = await askClaudeJson(env, origin, FITNESS_SYSTEM_PROMPT, FITNESS_SCHEMA, content,
    { maxTokens: 16000, effort: 'medium', timeout: 180000 });
  if (result.error) return result.error;
  if (result.data.is_program === false) {
    return jsonResponse({ error: 'not_program', error_description: 'V dokumentu ni fitnes programa.' }, 422, origin);
  }
  return jsonResponse(result.data, 200, origin);
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
    if (request.method === 'POST' && url.pathname.replace(/\/$/, '') === '/supplement') {
      return readSupplement(request, env, origin);
    }
    if (request.method === 'POST' && url.pathname.replace(/\/$/, '') === '/fitness') {
      return readFitnessProgram(request, env, origin);
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
