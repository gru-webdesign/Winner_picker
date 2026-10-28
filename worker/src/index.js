/**
 * Žreb API: Cloudflare Worker koji prosleđuje zahteve Apify-ju i krije APIFY_TOKEN.
 *
 * Dozvoljene su samo rute koje Žreb koristi (iste putanje kao Apify API v2):
 *   POST /acts/apify~instagram-comment-scraper/runs   pokreće preuzimanje (samo instagram.com linkovi)
 *   GET  /actor-runs/:id                              status preuzimanja
 *   POST /actor-runs/:id/abort                        otkazivanje
 *   GET  /datasets/:id                                broj preuzetih komentara
 *   GET  /datasets/:id/items                          komentari
 *
 * Promenljive (wrangler.toml / Dashboard):
 *   APIFY_TOKEN      secret, obavezno
 *   ALLOWED_ORIGINS  npr. "https://gru-webdesign.github.io" (više odvojiti zarezom, "*" = svi)
 *   MAX_COMMENTS     najviše komentara po objavi (štiti kredit), podrazumevano 2000
 *   MAX_POSTS        najviše objava po žrebu, podrazumevano 10
 */
const APIFY = "https://api.apify.com/v2";
const ACTOR = "apify~instagram-comment-scraper";
const IG_POST = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/;
const ID = "[A-Za-z0-9]{6,40}";
const ROUTES = [
  { method: "POST", re: new RegExp(`^/acts/${ACTOR}/runs$`), kind: "start" },
  { method: "GET", re: new RegExp(`^/actor-runs/${ID}$`) },
  { method: "POST", re: new RegExp(`^/actor-runs/${ID}/abort$`) },
  { method: "GET", re: new RegExp(`^/datasets/${ID}$`) },
  { method: "GET", re: new RegExp(`^/datasets/${ID}/items$`), query: ["clean", "format", "offset", "limit"] },
];

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  // Bez Origin zaglavlja (isti sajt ili curl) zahtev prolazi; Origin ionako može da se lažira van pregledača.
  const ok = !origin || allowed.includes("*") || allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : (ok ? origin : allowed[0] || ""),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
    if (!cors.ok) return json({ error: { message: "Ovaj sajt nema pristup serveru." } }, 403, cors.headers);
    if (!env.APIFY_TOKEN) return json({ error: { message: "Na serveru nije podešen APIFY_TOKEN." } }, 500, cors.headers);

    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "zreb-api" }, 200, cors.headers);

    const route = ROUTES.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!route) return json({ error: { message: "Nepoznata ruta." } }, 404, cors.headers);

    const target = new URL(APIFY + url.pathname);
    (route.query || []).forEach(k => { if (url.searchParams.has(k)) target.searchParams.set(k, url.searchParams.get(k)); });

    let body;
    if (route.kind === "start") {
      let input;
      try { input = await req.json(); } catch { return json({ error: { message: "Neispravan zahtev." } }, 400, cors.headers); }
      const maxPosts = parseInt(env.MAX_POSTS, 10) || 10;
      const maxComments = parseInt(env.MAX_COMMENTS, 10) || 2000;
      const urls = Array.isArray(input.directUrls) ? [...new Set(input.directUrls.map(String))] : [];
      if (!urls.length || urls.length > maxPosts || !urls.every(u => IG_POST.test(u))) {
        return json({ error: { message: `Pošalji od 1 do ${maxPosts} linkova Instagram objava.` } }, 400, cors.headers);
      }
      const limit = Math.min(maxComments, Math.max(1, parseInt(input.resultsLimit, 10) || maxComments));
      body = JSON.stringify({ directUrls: urls, resultsLimit: limit, includeNestedComments: !!input.includeNestedComments });
    } else if (req.method === "POST") {
      body = "";
    }

    const res = await fetch(target, {
      method: req.method,
      headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: req.method === "POST" ? body : undefined,
    });

    // Ne prosleđujemo podatke o Apify nalogu: iz odgovora o pokretanju vraćamo samo ono što app koristi.
    const text = await res.text();
    if (res.ok && (route.kind === "start" || /^\/actor-runs\/[^/]+$/.test(url.pathname))) {
      try {
        const d = JSON.parse(text).data || {};
        return json({ data: { id: d.id, status: d.status, defaultDatasetId: d.defaultDatasetId } }, res.status, cors.headers);
      } catch { /* pada na običan odgovor ispod */ }
    }
    if (res.ok && /^\/datasets\/[^/]+$/.test(url.pathname)) {
      try { const d = JSON.parse(text).data || {}; return json({ data: { itemCount: d.itemCount } }, res.status, cors.headers); } catch {}
    }
    return new Response(text, { status: res.status, headers: { ...cors.headers, "Content-Type": "application/json; charset=utf-8" } });
  },
};
