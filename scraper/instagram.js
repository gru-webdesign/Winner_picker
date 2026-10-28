/**
 * Žreb: Instagram scraper bez spoljnih servisa i bez zavisnosti (Node.js 18.17+).
 *
 * Koristi iste interne web endpoint-e koje koristi instagram.com u pregledaču
 * (isti pristup kao open-source alati Instaloader i instagrapi):
 *
 *   GET  /                                                 kolačići csrftoken, mid, ig_did
 *   POST /api/v1/web/accounts/login/ajax/                  prijava (#PWD_INSTAGRAM_BROWSER:0 format)
 *   POST /api/v1/web/accounts/login/ajax/two_factor/       dvofaktorska potvrda
 *   GET  /api/v1/accounts/edit/web_form_data/              ko je prijavljen
 *   GET  /api/v1/media/{id}/info/                          podaci o objavi
 *   GET  /api/v1/media/{id}/comments/                      komentari, paginacija min_id / max_id
 *   GET  /api/v1/media/{id}/comments/{pk}/child_comments/  odgovori na komentar
 *   GET  /api/v1/users/web_profile_info/?username=         profil naloga
 *   GET  /api/v1/friendships/{id}/followers/?query=        pretraga pratilaca (provera praćenja)
 *
 * Instagram ove endpoint-e menja bez najave. Sve putanje, zaglavlja i pauze su u ovom fajlu.
 */

export const IG_BASE = (process.env.ZREB_IG_BASE || "https://www.instagram.com").replace(/\/+$/, "");
const APP_ID = "936619743392459";
const ASBD_ID = "129477";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Množilac svih pauza (1 = normalno). Testovi ga postavljaju na 0, a 2 je opreznije za velike objave. */
export const PACE = Math.max(0, Number(process.env.ZREB_PACE ?? 1));

const LOGIN_MSG = "Instagram traži prijavu. Prijavi se ponovo u Žrebu.";
const CHECKPOINT_MSG =
  "Instagram traži potvrdu naloga. Otvori instagram.com u pregledaču sa istim nalogom, potvrdi da si to ti, pa se ponovo prijavi u Žrebu.";
const RATE_MSG =
  "Instagram je privremeno ograničio zahteve sa ovog naloga. Sačekaj 10 do 15 minuta pa pokušaj ponovo.";

export class IgError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new IgError("cancelled", "Preuzimanje je otkazano."));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new IgError("cancelled", "Preuzimanje je otkazano."));
      },
      { once: true }
    );
  });
}

/* ---------- Linkovi i ID objave ---------- */

export function parsePostUrl(input) {
  const m = String(input || "")
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase().startsWith("reel") ? "reel" : m[1].toLowerCase();
  return { code: m[2], url: `https://www.instagram.com/${kind}/${m[2]}/` };
}

/** Kod iz linka (npr. DA1b2C3d4E5) je ID objave zapisan u bazi 64. */
export function shortcodeToId(code) {
  let id = 0n;
  for (const ch of String(code).slice(0, 11)) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new IgError("bad_link", "Link objave nije ispravan.");
    id = id * 64n + BigInt(i);
  }
  return id.toString();
}

/* ---------- Sesija (kolačići) ---------- */

export class Session {
  constructor(cookies = {}) {
    this.cookies = { ...cookies };
    this.claim = "0";
    if (this.cookies.sessionid && !this.cookies.ds_user_id) {
      const uid = decodeURIComponent(this.cookies.sessionid).split(":")[0];
      if (/^\d+$/.test(uid)) this.cookies.ds_user_id = uid;
    }
  }
  get userId() {
    return this.cookies.ds_user_id || null;
  }
  get loggedIn() {
    return !!this.cookies.sessionid;
  }
  cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const line of list) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      const gone =
        !v ||
        v === '""' ||
        attrs.some(a => /^\s*max-age=0\s*$/i.test(a)) ||
        attrs.some(a => /expires=.*(1970|1969)/i.test(a));
      if (gone) delete this.cookies[k];
      else this.cookies[k] = v;
    }
    const claim = res.headers.get("x-ig-set-www-claim");
    if (claim) this.claim = claim;
  }
  toJSON() {
    return { cookies: this.cookies, claim: this.claim };
  }
  static from(o) {
    const s = new Session(o?.cookies || {});
    if (o?.claim) s.claim = o.claim;
    return s;
  }
}

/* ---------- HTTP ---------- */

export async function igRequest(session, path, { method = "GET", form, referer, signal, accept } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-IG-WWW-Claim": session.claim || "0",
    "X-Requested-With": "XMLHttpRequest",
    Referer: referer || IG_BASE + "/",
    Origin: IG_BASE,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (session.cookies.csrftoken) headers["X-CSRFToken"] = session.cookies.csrftoken;
  const ck = session.cookieHeader();
  if (ck) headers.Cookie = ck;
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  let res;
  try {
    res = await fetch(path.startsWith("http") ? path : IG_BASE + path, { method, headers, body, redirect: "manual", signal });
  } catch (e) {
    if (signal?.aborted) throw new IgError("cancelled", "Preuzimanje je otkazano.");
    throw new IgError("network", "Instagram nije dostupan. Proveri internet vezu.");
  }
  session.absorb(res);
  return res;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function igJson(session, path, opts = {}) {
  const { retries = 4, onWait, signal } = opts;
  for (let attempt = 0; ; attempt++) {
    const res = await igRequest(session, path, opts);
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {}
    const msg = (j && (j.message || j.error_type || j.feedback_title)) || "";

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      if (/challenge|checkpoint/.test(loc)) throw new IgError("checkpoint", CHECKPOINT_MSG);
      throw new IgError("login_required", LOGIN_MSG);
    }
    if (j && (j.message === "checkpoint_required" || j.message === "challenge_required" || j.checkpoint_url || j.challenge))
      throw new IgError("checkpoint", CHECKPOINT_MSG);
    if (j && (j.message === "login_required" || j.require_login)) throw new IgError("login_required", LOGIN_MSG);

    const limited = RETRYABLE.has(res.status) || (j && (j.spam || /wait a few minutes|try again later|rate limit/i.test(msg)));
    if (limited) {
      if (attempt >= retries) throw new IgError("rate_limited", RATE_MSG);
      const wait = (Math.min(120000, 5000 * 2 ** attempt) + Math.random() * 2000) * PACE;
      onWait?.(wait);
      await sleep(wait, signal);
      continue;
    }
    if (res.status === 401) throw new IgError("login_required", LOGIN_MSG);
    if (res.status === 404 || /not found|unavailable|does not exist|no longer available/i.test(msg))
      throw new IgError("not_found", "Objava ne postoji, privatna je ili nije dostupna ovom nalogu.");
    if (!j) throw new IgError("bad_response", `Instagram je vratio neočekivan odgovor (HTTP ${res.status}).`);
    if (!res.ok || j.status === "fail") throw new IgError("failed", msg ? `Instagram: ${msg}` : `Greška HTTP ${res.status}.`);
    return j;
  }
}

/* ---------- Prijava ---------- */

async function prepareSession(session = new Session()) {
  const res = await igRequest(session, "/", { accept: "text/html,application/xhtml+xml" });
  const html = await res.text();
  if (!session.cookies.csrftoken) {
    const m = html.match(/"csrf_token":"([^"]+)"/);
    if (m) session.cookies.csrftoken = m[1];
  }
  if (!session.cookies.csrftoken) {
    const r2 = await igRequest(session, "/api/v1/web/login_page/");
    await r2.text();
  }
  if (!session.cookies.csrftoken)
    throw new IgError("bad_response", "Instagram nije vratio sigurnosni token. Pokušaj ponovo za minut.");
  return session;
}

async function readLoginResponse(session, res) {
  let j = {};
  try {
    j = JSON.parse(await res.text());
  } catch {}
  if (j.two_factor_required) {
    const info = j.two_factor_info || {};
    const method = info.totp_two_factor_on
      ? "iz aplikacije za autentifikaciju"
      : info.sms_two_factor_on
        ? `iz SMS poruke (broj se završava sa ${String(info.obfuscated_phone_number || "").slice(-4)})`
        : "za potvrdu";
    return { status: "two_factor", session, identifier: info.two_factor_identifier, method };
  }
  if (j.checkpoint_url || j.message === "checkpoint_required" || j.message === "challenge_required")
    throw new IgError("checkpoint", CHECKPOINT_MSG);
  if (j.authenticated && session.loggedIn) return { status: "ok", session };
  if (j.error_type === "bad_password" || (j.authenticated === false && j.user)) throw new IgError("bad_credentials", "Pogrešna lozinka.");
  if (j.error_type === "invalid_user" || (j.authenticated === false && j.user === false))
    throw new IgError("bad_credentials", "Nalog sa tim korisničkim imenom ne postoji.");
  if (j.error_type === "sms_code_validation_code_invalid" || j.error_type === "invalid_verficaition_code" || j.error_type === "invalid_verification_code")
    throw new IgError("bad_code", "Kod nije ispravan. Pokušaj ponovo.");
  if (res.status === 429 || j.spam) throw new IgError("rate_limited", RATE_MSG);
  throw new IgError("login_failed", j.message ? `Instagram: ${j.message}` : `Prijava nije uspela (HTTP ${res.status}).`);
}

export async function login(username, password) {
  const session = await prepareSession();
  const res = await igRequest(session, "/api/v1/web/accounts/login/ajax/", {
    method: "POST",
    referer: IG_BASE + "/accounts/login/",
    form: {
      enc_password: `#PWD_INSTAGRAM_BROWSER:0:${Math.floor(Date.now() / 1000)}:${password}`,
      username,
      queryParams: "{}",
      optIntoOneTap: "false",
      trustedDeviceRecords: "{}",
    },
  });
  return readLoginResponse(session, res);
}

export async function loginTwoFactor(session, username, identifier, code) {
  const res = await igRequest(session, "/api/v1/web/accounts/login/ajax/two_factor/", {
    method: "POST",
    referer: IG_BASE + "/accounts/login/two_factor/",
    form: { username, verificationCode: String(code).replace(/\s/g, ""), identifier, queryParams: "{}", trust_signal: "true" },
  });
  const r = await readLoginResponse(session, res);
  if (r.status === "two_factor") throw new IgError("bad_code", "Kod nije prihvaćen. Pokušaj ponovo.");
  return r;
}

/** Sesija iz kolačića sessionid kopiranog iz pregledača. */
export async function sessionFromCookie(sessionid) {
  const clean = String(sessionid || "").trim().replace(/^sessionid=/, "").replace(/;.*$/, "");
  if (!clean) throw new IgError("bad_credentials", "Unesi vrednost kolačića sessionid.");
  const session = new Session({ sessionid: clean });
  try {
    await prepareSession(session);
  } catch {}
  return session;
}

export async function whoAmI(session) {
  try {
    const j = await igJson(session, "/api/v1/accounts/edit/web_form_data/", { retries: 1 });
    const u = j.form_data?.username;
    if (u) return { username: u, id: session.userId };
  } catch (e) {
    if (["login_required", "checkpoint", "rate_limited", "network"].includes(e.code)) throw e;
  }
  if (session.userId) {
    const j = await igJson(session, `/api/v1/users/${session.userId}/info/`, { retries: 1 });
    if (j.user?.username) return { username: j.user.username, id: String(j.user.pk ?? j.user.id) };
  }
  throw new IgError("login_required", LOGIN_MSG);
}

/* ---------- Objava ---------- */

function normMedia(j, fallbackId, post) {
  const it = (j.items || [])[0] || {};
  const cand = it.image_versions2?.candidates || it.carousel_media?.[0]?.image_versions2?.candidates || [];
  const thumb = (cand.find(c => c.width && c.width <= 640) || cand[0] || {}).url || null;
  return {
    id: String(it.pk || String(it.id || "").split("_")[0] || fallbackId),
    code: it.code || post.code,
    url: post.url,
    owner: it.user?.username || null,
    ownerId: it.user ? String(it.user.pk ?? it.user.id) : null,
    caption: it.caption?.text || "",
    thumb,
    commentCount: it.comment_count ?? null,
    likeCount: it.like_count ?? null,
    takenAt: it.taken_at ? it.taken_at * 1000 : null,
    commentsDisabled: !!it.comments_disabled,
  };
}

export async function getMedia(session, post, signal) {
  let id = shortcodeToId(post.code);
  try {
    return normMedia(await igJson(session, `/api/v1/media/${id}/info/`, { referer: post.url, signal }), id, post);
  } catch (e) {
    if (!["not_found", "failed", "bad_response"].includes(e.code)) throw e;
  }
  // Rezervni put: ID iz HTML-a stranice objave (dugi kodovi, promenjen format).
  const res = await igRequest(session, `/p/${post.code}/`, { accept: "text/html", signal });
  const html = await res.text();
  const m = html.match(/"media_id"\s*:\s*"(\d+)"/) || html.match(/instagram:\/\/media\?id=(\d+)/) || html.match(/"media_id":(\d+)/);
  if (!m) throw new IgError("not_found", "Objava ne postoji, privatna je ili nije dostupna ovom nalogu.");
  id = m[1];
  try {
    return normMedia(await igJson(session, `/api/v1/media/${id}/info/`, { referer: post.url, signal }), id, post);
  } catch {
    return { id, code: post.code, url: post.url, owner: null, ownerId: null, caption: "", thumb: null, commentCount: null };
  }
}

/* ---------- Komentari ---------- */

function normComment(c, parentId) {
  return {
    id: String(c.pk ?? c.id),
    username: c.user?.username || "",
    userId: c.user ? String(c.user.pk ?? c.user.id) : null,
    text: c.text || "",
    timestamp: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
    isReply: !!parentId,
    parentId: parentId || null,
    verified: !!c.user?.is_verified,
    likes: c.comment_like_count ?? 0,
  };
}

/** Pauza između strana: deluje kao čovek koji skroluje, sa dužim predahom na svakih 20 strana. */
export const defaultPace = page => (900 + Math.random() * 900 + (page % 20 === 0 ? 4000 + Math.random() * 4000 : 0)) * PACE;

function nextCursor(j, kinds) {
  for (const [field, param, flag] of kinds) {
    if (j[field] && (flag == null || j[flag] !== false)) return [param, String(j[field])];
  }
  return null;
}

export async function scrapeComments(session, media, { signal, replies = false, limit = 0, onProgress, pace = defaultPace } = {}) {
  const out = new Map();
  const parents = [];
  const ref = media.url || `${IG_BASE}/p/${media.code}/`;
  const add = (c, parentId) => {
    const n = normComment(c, parentId);
    if (n.username && !out.has(n.id)) out.set(n.id, n);
  };
  const wait = w => onProgress?.({ waiting: Math.round(w / 1000) });

  let cursor = null;
  const seen = new Set();
  let page = 0;
  let stale = 0;
  let top = 0;
  for (;;) {
    const q = new URLSearchParams({ can_support_threading: "true", permalink_enabled: "false" });
    if (cursor) q.set(cursor[0], cursor[1]);
    const j = await igJson(session, `/api/v1/media/${media.id}/comments/?${q}`, { referer: ref, signal, onWait: wait });
    page++;
    const before = out.size;
    for (const c of j.comments || []) {
      add(c, null);
      top++;
      const preview = c.preview_child_comments || [];
      for (const r of preview) add(r, String(c.pk));
      if (replies && (c.child_comment_count || 0) > preview.length) parents.push(String(c.pk));
    }
    stale = out.size === before ? stale + 1 : 0;
    onProgress?.({ count: out.size, total: j.comment_count ?? media.commentCount ?? null, page, waiting: 0 });
    if (limit && top >= limit) break;
    if (j.has_more_comments === false && j.has_more_headload_comments === false) break;
    const next = nextCursor(j, [
      ["next_min_id", "min_id", "has_more_headload_comments"],
      ["next_max_id", "max_id", "has_more_comments"],
      ["next_min_id", "min_id", null],
    ]);
    if (!next || seen.has(next[1]) || stale >= 3) break;
    seen.add(next[1]);
    cursor = next;
    await sleep(pace(page), signal);
  }

  for (let i = 0; i < parents.length; i++) {
    const pk = parents[i];
    let cur = null;
    const seenC = new Set();
    for (;;) {
      const q = new URLSearchParams();
      if (cur) q.set(cur[0], cur[1]);
      const j = await igJson(session, `/api/v1/media/${media.id}/comments/${pk}/child_comments/?${q}`, {
        referer: ref,
        signal,
        onWait: wait,
      });
      for (const r of j.child_comments || []) add(r, pk);
      page++;
      onProgress?.({ count: out.size, replies: { done: i + 1, total: parents.length }, waiting: 0 });
      const next = nextCursor(j, [
        ["next_max_child_cursor", "max_id", "has_more_tail_child_comments"],
        ["next_min_child_cursor", "min_id", "has_more_head_child_comments"],
      ]);
      if (!next || seenC.has(next[1])) break;
      seenC.add(next[1]);
      cur = next;
      await sleep(pace(page), signal);
    }
    await sleep(pace(page), signal);
  }
  return [...out.values()];
}

/* ---------- Praćenje ---------- */

export async function getProfile(session, username, signal) {
  const j = await igJson(session, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
    referer: `${IG_BASE}/${username}/`,
    signal,
  });
  const u = j.data?.user;
  if (!u) throw new IgError("not_found", `Nalog @${username} ne postoji.`);
  return {
    id: String(u.id),
    username: u.username,
    isPrivate: !!u.is_private,
    followedByViewer: !!u.followed_by_viewer,
  };
}

/**
 * Da li `follower` prati nalog `target`. Pretražuje listu pratilaca naloga (isto što radi polje za pretragu
 * u prozoru "Pratioci" na instagram.com). Vraća true, false ili null kada lista nije vidljiva ovom nalogu.
 */
export async function isFollowing(session, follower, target, signal) {
  if (target.isPrivate && !target.followedByViewer && session.userId !== target.id) return null;
  const q = new URLSearchParams({ count: "12", search_surface: "follow_list_page", query: follower });
  const j = await igJson(session, `/api/v1/friendships/${target.id}/followers/?${q}`, {
    referer: `${IG_BASE}/${target.username}/followers/`,
    signal,
  });
  const f = follower.toLowerCase();
  return (j.users || []).some(u => String(u.username || "").toLowerCase() === f);
}
