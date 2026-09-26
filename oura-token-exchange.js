/**
 * Kilometrina — Oura OAuth2 token exchange (Cloudflare Worker)
 *
 * Why this exists: Oura retired Personal Access Tokens, so the only way in is
 * OAuth2 — and Oura's token endpoint requires client_secret. A secret cannot
 * live in index.html, because GitHub Pages serves that file to anyone. This
 * Worker is the one place that holds the secret: the page sends it an
 * authorization code, the Worker trades it for tokens, the page gets tokens.
 *
 * It stores nothing and logs nothing. It is a relay, not a backend.
 *
 * ---- Deploy (details in README.md, "Oura Ring nastavitev") --------------
 *   npx wrangler secret put OURA_CLIENT_ID      --name kilometrina-oura
 *   npx wrangler secret put OURA_CLIENT_SECRET  --name kilometrina-oura
 *   npx wrangler deploy oura-token-exchange.js \
 *     --name kilometrina-oura \
 *     --compatibility-date 2025-01-01 \
 *     --var ALLOWED_ORIGIN:https://YOUR-USERNAME.github.io
 *
 * ALLOWED_ORIGIN is the exact origin of the hosted page (scheme + host, no
 * path, no trailing slash). Several may be comma-separated, which is handy
 * while testing from http://localhost:8000. If it is unset, this Worker
 * refuses every request rather than accepting calls from anywhere.
 * ------------------------------------------------------------------------
 */

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
