// ── That Place — Gemini vision proxy (Cloudflare Worker) ──────────────────
// Holds the Gemini API key as a server-side SECRET (env.GEMINI_KEY) so it is
// never shipped to the browser. The app POSTs an image here; this forwards it
// to Gemini and returns a small JSON verdict. Deploy: see PROXY-SETUP.md.

const MODEL = 'gemini-2.0-flash';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allow = corsOrigin(origin, env);
    const path = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(allow) });
    // Origin allowlist — deters other sites' JS from abusing your key. Only enforced when an
    // Origin header is present (cross-site fetch); <img> photo loads send none and must pass.
    if (origin && env.ALLOWED_ORIGIN && allow === 'null') return json({ error: 'forbidden origin' }, 403, allow);

    // ── Google Places (New): restaurant search ──
    if (path === '/places') return placesSearch(request, env, allow);
    // ── Google Places photo proxy (keeps MAPS_KEY out of <img> URLs) ──
    if (path === '/photo') return placePhoto(request, env, allow);

    // ── Gemini vision verify (default / "/") ──
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, allow);
    if (!env.GEMINI_KEY) return json({ error: 'server not configured' }, 500, allow);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, allow); }
    const { image, mime, name, category, origin: foodOrigin } = body || {};
    if (!image || typeof image !== 'string') return json({ error: 'missing image' }, 400, allow);
    if (image.length > 2200000) return json({ error: 'image too large' }, 413, allow); // ~1.6MB binary

    const prompt = `Look at this photo. Does it clearly show ${name} (a ${category || 'dish'} from ${foodOrigin || 'unknown'})? `
      + `Reply with ONLY JSON, no prose: {"isDish": true|false, "isFood": true|false, "label": "<short description of what you see>"}. `
      + `Set isDish true only if the photo plausibly shows ${name} or a close variant.`;

    const gReq = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || 'image/jpeg', data: image } }] }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`;

    let gRes;
    try { gRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gReq) }); }
    catch (e) { return json({ error: 'gemini unreachable' }, 502, allow); }
    if (!gRes.ok) return json({ error: 'gemini ' + gRes.status }, 502, allow);

    const data = await gRes.json();
    const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text).join('') || '';
    const m = text.match(/\{[\s\S]*\}/);
    let verdict = { isDish: false, isFood: false, label: '' };
    if (m) { try { verdict = JSON.parse(m[0]); } catch (e) {} }
    return json(verdict, 200, allow);
  },
};

// ── Places API (New) Text Search → compact restaurant cards ──────────────
async function placesSearch(request, env, allow) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, allow);
  if (!env.MAPS_KEY) return json({ error: 'maps not configured' }, 500, allow);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, allow); }
  const { query, lat, lon, radius } = body || {};
  if (!query) return json({ error: 'missing query' }, 400, allow);

  const reqBody = { textQuery: String(query).slice(0, 256), maxResultCount: 12, rankPreference: 'DISTANCE' };
  if (typeof lat === 'number' && typeof lon === 'number') {
    reqBody.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(Math.max(radius || 8000, 1), 50000) } };
  }
  const fieldMask = [
    'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount',
    'places.priceLevel', 'places.currentOpeningHours.openNow', 'places.googleMapsUri',
    'places.photos', 'places.reviews', 'places.location', 'places.primaryTypeDisplayName',
  ].join(',');

  let res;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.MAPS_KEY, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(reqBody),
    });
  } catch (e) { return json({ error: 'places unreachable' }, 502, allow); }
  if (!res.ok) return json({ error: 'places ' + res.status, detail: (await res.text()).slice(0, 300) }, 502, allow);

  const data = await res.json();
  const places = (data.places || []).map(p => ({
    name: (p.displayName && p.displayName.text) || 'Unnamed',
    address: p.formattedAddress || '',
    rating: p.rating || null,
    reviews: p.userRatingCount || 0,
    price: priceToSymbol(p.priceLevel),
    openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
    mapsUri: p.googleMapsUri || '',
    category: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
    photo: (p.photos && p.photos[0] && p.photos[0].name) || '',
    snippet: (p.reviews && p.reviews[0] && p.reviews[0].text && p.reviews[0].text.text) || '',
    lat: p.location ? p.location.latitude : null,
    lon: p.location ? p.location.longitude : null,
  }));
  return json({ places }, 200, allow);
}

function priceToSymbol(level) {
  const map = { PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' };
  return map[level] || '';
}

// ── Place photo proxy: streams the image so MAPS_KEY never appears client-side ──
async function placePhoto(request, env, allow) {
  if (!env.MAPS_KEY) return json({ error: 'maps not configured' }, 500, allow);
  const u = new URL(request.url);
  const name = u.searchParams.get('name') || '';
  const w = Math.min(parseInt(u.searchParams.get('w') || '200', 10) || 200, 800);
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return json({ error: 'bad photo name' }, 400, allow);
  let res;
  try {
    res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${w}&key=${env.MAPS_KEY}`, { redirect: 'follow' });
  } catch (e) { return json({ error: 'photo unreachable' }, 502, allow); }
  if (!res.ok) return json({ error: 'photo ' + res.status }, 502, allow);
  const headers = { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' };
  if (allow && allow !== 'null') headers['Access-Control-Allow-Origin'] = allow;
  return new Response(res.body, { status: 200, headers });
}

function corsOrigin(origin, env) {
  if (!origin) return '*';
  // Always allow local dev and any Vercel deployment (production + previews) — the
  // API key lives server-side, so this allowlist is just light anti-abuse, and an
  // over-strict match was making the app silently fall back to the OSM list.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  if (/^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i.test(origin)) return origin;
  if (!env.ALLOWED_ORIGIN) return '*';
  const list = env.ALLOWED_ORIGIN.split(',').map(s => s.trim());
  return list.includes(origin) ? origin : 'null';
}
function cors(allow) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allow && allow !== 'null') h['Access-Control-Allow-Origin'] = allow;
  return h;
}
function json(obj, status, allow) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(allow)) });
}
