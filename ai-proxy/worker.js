/**
 * Islamic AI — Anthropic API proxy (Cloudflare Worker)
 *
 * Why this exists: the app is a static GitHub Pages site, so it cannot hold an
 * API key — anything in index.html is public. This worker keeps the key in a
 * Cloudflare secret and forwards chat requests to the Anthropic Messages API.
 *
 * Deploy (one time, free tier is enough):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Paste this file, Deploy
 *   3. Worker → Settings → Variables → Add secret: ANTHROPIC_API_KEY
 *      (key from https://platform.claude.com → API Keys)
 *   4. Copy the worker URL (https://<name>.<subdomain>.workers.dev) into
 *      AI_PROXY_URL in index.html
 */

// Only this origin may call the proxy — change if the site moves.
const ALLOWED_ORIGIN = 'https://shams0011.github.io';

// Model choice lives here (server-side), not in the client, so it can be
// upgraded without redeploying the site. claude-sonnet-5 replaces the retired
// claude-sonnet-4-20250514 the app used before.
const MODEL = 'claude-sonnet-5';

const MAX_TOKENS_CAP = 2048;   // hard ceiling regardless of what the client asks
const MAX_MESSAGES = 40;       // cap history length per request
const MAX_CHARS = 24000;       // cap total request text — keeps costs bounded

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// ── GET /live — resolve the current Makkah/Madinah live-stream video IDs ──
// YouTube live streams rotate their video IDs every few weeks, which kept
// breaking the hardcoded embeds in the app. YouTube's channel-based
// embed (embed/live_stream?channel=) is dead, and the client can't scrape
// YouTube cross-origin, so the worker does it: one search per city with the
// live-only filter (sp=EgJAAQ==), first result wins. Results are edge-cached
// for 30 minutes. No key or quota involved — plain HTML scrape.
const LIVE_QUERIES = {
  makkah: 'makkah+live+kaaba',
  madinah: 'madinah+live+masjid+nabawi',
};

async function resolveLiveId(query) {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${query}&sp=EgJAAQ%253D%253D`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function handleLive(url) {
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/live');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [makkah, madinah] = await Promise.all([
    resolveLiveId(LIVE_QUERIES.makkah),
    resolveLiveId(LIVE_QUERIES.madinah),
  ]);
  const resp = Response.json({ makkah, madinah }, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=1800',
      // Public, non-sensitive data — open CORS so the app also works from
      // localhost previews, unlike the key-guarded chat endpoint below.
      'Access-Control-Allow-Origin': '*',
    },
  });
  if (makkah || madinah) await cache.put(cacheKey, resp.clone());
  return resp;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/live') {
      return handleLive(new URL(request.url));
    }
    if (request.method !== 'POST') {
      return Response.json({ error: { message: 'POST only' } }, { status: 405, headers: cors });
    }
    if (origin && origin !== ALLOWED_ORIGIN) {
      return Response.json({ error: { message: 'origin not allowed' } }, { status: 403, headers: cors });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return Response.json({ error: { message: 'ANTHROPIC_API_KEY secret not set on the worker' } }, { status: 500, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: { message: 'invalid JSON' } }, { status: 400, headers: cors });
    }

    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : null;
    if (!messages || !messages.length) {
      return Response.json({ error: { message: 'messages required' } }, { status: 400, headers: cors });
    }
    const totalChars = messages.reduce((n, m) => n + String(m.content || '').length, 0)
      + String(body.system || '').length;
    if (totalChars > MAX_CHARS) {
      return Response.json({ error: { message: 'request too large' } }, { status: 413, headers: cors });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(Number(body.max_tokens) || 1200, MAX_TOKENS_CAP),
        system: typeof body.system === 'string' ? body.system : undefined,
        messages,
      }),
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  },
};
