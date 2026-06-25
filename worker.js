// ── That Place — Gemini vision proxy (Cloudflare Worker) ──────────────────
// Holds the Gemini API key as a server-side SECRET (env.GEMINI_KEY) so it is
// never shipped to the browser. The app POSTs an image here; this forwards it
// to Gemini and returns a small JSON verdict. Deploy: see PROXY-SETUP.md.

const MODEL = 'gemini-2.0-flash';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allow = corsOrigin(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(allow) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, allow);
    // Origin allowlist — deters other sites from abusing your key (not airtight: Origin can be spoofed by non-browsers).
    if (env.ALLOWED_ORIGIN && allow === 'null') return json({ error: 'forbidden origin' }, 403, allow);
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

function corsOrigin(origin, env) {
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
