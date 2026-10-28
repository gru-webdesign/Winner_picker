#!/usr/bin/env node
/**
 * Žreb: lokalni server. Pokreće aplikaciju na http://localhost:4747 i preuzima komentare sa Instagrama
 * preko tvog naloga. Nema spoljnih servisa ni npm paketa. Potreban je samo Node.js 18.17 ili noviji.
 *
 *   node server.js            pokreni i otvori pregledač
 *   node server.js --no-open  pokreni bez otvaranja pregledača
 *   PORT=5000 node server.js  drugi port
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ig from "./scraper/instagram.js";

if (typeof Headers === "undefined" || typeof Headers.prototype.getSetCookie !== "function") {
  console.error("\n  Žreb traži Node.js 18.17 ili noviji. Preuzmi LTS verziju sa https://nodejs.org\n");
  process.exit(1);
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 4747;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(ROOT, ".zreb");
const SESSION_FILE = path.join(DATA_DIR, "session.json");
const VERSION = "2.0.0";
const MAX_POSTS = 10;

/* ---------- Stanje ---------- */

let session = null;
let account = null;
const pendingLogins = new Map();
const jobs = new Map();
const profileCache = new Map();

function loadSession() {
  try {
    const o = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    session = ig.Session.from(o.session);
    account = o.account || null;
  } catch {
    session = null;
    account = null;
  }
}
function saveSession() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ session, account, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}
function clearSession() {
  session = null;
  account = null;
  profileCache.clear();
  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {}
}
loadSession();

function persistAfter(fn) {
  return async (...a) => {
    try {
      return await fn(...a);
    } finally {
      if (session) saveSession();
    }
  };
}

/* ---------- HTTP pomoćne funkcije ---------- */

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": typeof data === "object" && !Buffer.isBuffer(data) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}
function fail(res, e, status) {
  const code = e.code || "error";
  const st = status || { login_required: 401, checkpoint: 401, bad_credentials: 400, bad_code: 400, bad_link: 400, bad_request: 400, not_found: 404, rate_limited: 429, busy: 409 }[code] || 500;
  send(res, st, { error: e.message || "Greška.", code });
}
async function readJson(req) {
  if (!/application\/json/.test(req.headers["content-type"] || "")) throw Object.assign(new Error("Neispravan zahtev."), { code: "bad_request" });
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw Object.assign(new Error("Zahtev je prevelik."), { code: "bad_request" });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Neispravan JSON."), { code: "bad_request" });
  }
}
function requireLogin() {
  if (!session?.loggedIn) throw new ig.IgError("login_required", "Prvo se prijavi na Instagram nalog.");
}
function onAuthError(e) {
  if (e.code === "login_required" || e.code === "checkpoint") clearSession();
}

/* ---------- Prijava ---------- */

async function handleLogin(body) {
  const username = String(body.username || "").trim().replace(/^@/, "");
  const password = String(body.password || "");
  if (!username || !password) throw new ig.IgError("bad_credentials", "Unesi korisničko ime i lozinku.");
  const r = await ig.login(username, password);
  if (r.status === "two_factor") {
    const loginId = crypto.randomUUID();
    pendingLogins.set(loginId, { session: r.session, username, identifier: r.identifier, at: Date.now() });
    return { status: "two_factor", loginId, method: r.method };
  }
  return finishLogin(r.session);
}
async function handleTwoFactor(body) {
  const p = pendingLogins.get(String(body.loginId || ""));
  if (!p || Date.now() - p.at > 10 * 60 * 1000) throw new ig.IgError("bad_code", "Prijava je istekla. Počni ponovo.");
  const r = await ig.loginTwoFactor(p.session, p.username, p.identifier, body.code);
  pendingLogins.delete(String(body.loginId));
  return finishLogin(r.session);
}
async function handleCookie(body) {
  const s = await ig.sessionFromCookie(body.sessionid);
  return finishLogin(s);
}
async function finishLogin(s) {
  const me = await ig.whoAmI(s);
  session = s;
  account = { username: me.username, id: me.id || s.userId };
  profileCache.clear();
  saveSession();
  return { status: "ok", user: account };
}

/* ---------- Preuzimanje komentara ---------- */

function publicJob(j) {
  return {
    id: j.id,
    status: j.status,
    phase: j.phase,
    count: j.count,
    total: j.total,
    waiting: j.waiting,
    replies: j.replies,
    posts: j.posts,
    error: j.error,
    code: j.code,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

function startJob(body) {
  requireLogin();
  if ([...jobs.values()].some(j => j.status === "running"))
    throw new ig.IgError("busy", "Preuzimanje je već u toku. Sačekaj da se završi ili ga otkaži.");
  const raw = Array.isArray(body.urls) ? body.urls : [body.url];
  const posts = [];
  for (const u of raw.filter(Boolean)) {
    const p = ig.parsePostUrl(u);
    if (!p) throw new ig.IgError("bad_link", `Ovo nije link Instagram objave: ${u}`);
    if (!posts.some(x => x.code === p.code)) posts.push(p);
  }
  if (!posts.length) throw new ig.IgError("bad_link", "Nalepi link Instagram objave.");
  if (posts.length > MAX_POSTS) throw new ig.IgError("bad_link", `Najviše ${MAX_POSTS} objava u jednom žrebu.`);
  const job = {
    id: crypto.randomUUID(),
    status: "running",
    phase: "Otvaram objavu",
    count: 0,
    total: null,
    waiting: 0,
    replies: null,
    posts: [],
    comments: [],
    ctl: new AbortController(),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  runJob(job, posts, { replies: !!body.replies, limit: Math.max(0, parseInt(body.limit, 10) || 0) });
  return publicJob(job);
}

async function runJob(job, posts, opts) {
  const signal = job.ctl.signal;
  let base = 0;
  try {
    for (const post of posts) {
      job.phase = posts.length > 1 ? `Objava ${job.posts.length + 1} od ${posts.length}` : "Otvaram objavu";
      const media = await ig.getMedia(session, post, signal);
      if (media.commentsDisabled) throw new ig.IgError("failed", "Komentari su isključeni na ovoj objavi.");
      job.posts.push({ url: post.url, code: media.code, owner: media.owner, caption: media.caption.slice(0, 300), thumb: media.thumb, commentCount: media.commentCount });
      if (media.commentCount != null) job.total = (job.total || 0) + media.commentCount;
      job.phase = "Preuzimam komentare";
      const list = await ig.scrapeComments(session, media, {
        signal,
        replies: opts.replies,
        limit: opts.limit,
        onProgress: p => {
          if (p.count != null) job.count = base + p.count;
          if (p.waiting != null) job.waiting = p.waiting;
          if (p.replies) {
            job.replies = p.replies;
            job.phase = "Preuzimam odgovore";
          }
        },
      });
      for (const c of list) job.comments.push({ ...c, post: media.code });
      base = job.comments.length;
      job.count = base;
    }
    job.status = "done";
    job.phase = "Gotovo";
  } catch (e) {
    job.status = e.code === "cancelled" ? "cancelled" : "error";
    job.error = e.message;
    job.code = e.code;
    onAuthError(e);
  } finally {
    job.waiting = 0;
    job.finishedAt = Date.now();
    if (session) saveSession();
  }
}

/* ---------- Provera praćenja ---------- */

async function checkFollows(body) {
  requireLogin();
  const usernames = [...new Set((body.usernames || []).map(u => String(u).trim().replace(/^@/, "").toLowerCase()).filter(Boolean))].slice(0, 60);
  const accounts = [...new Set((body.accounts || []).map(u => String(u).trim().replace(/^@/, "").toLowerCase()).filter(Boolean))].slice(0, 10);
  if (!accounts.length) throw new ig.IgError("bad_request", "Upiši nalog koji pobednici treba da prate.");
  const targets = [];
  const accInfo = [];
  for (const a of accounts) {
    try {
      let p = profileCache.get(a);
      if (!p) {
        p = await ig.getProfile(session, a);
        profileCache.set(a, p);
        await ig.sleep((500 + Math.random() * 500) * ig.PACE);
      }
      targets.push(p);
      accInfo.push({ username: a, ok: true, private: p.isPrivate && !p.followedByViewer && session.userId !== p.id });
    } catch (e) {
      onAuthError(e);
      if (e.code === "login_required" || e.code === "checkpoint" || e.code === "rate_limited") throw e;
      accInfo.push({ username: a, ok: false, error: e.message });
    }
  }
  const results = {};
  for (const u of usernames) {
    results[u] = {};
    for (const t of targets) {
      if (u === t.username.toLowerCase()) {
        results[u][t.username] = true;
        continue;
      }
      try {
        results[u][t.username] = await ig.isFollowing(session, u, t);
      } catch (e) {
        onAuthError(e);
        if (e.code === "login_required" || e.code === "checkpoint" || e.code === "rate_limited") throw e;
        results[u][t.username] = null;
      }
      await ig.sleep((600 + Math.random() * 600) * ig.PACE);
    }
  }
  return { results, accounts: accInfo };
}

/* ---------- Slike objava (Instagram CDN ne dozvoljava direktno učitavanje sa drugih sajtova) ---------- */

async function proxyImage(res, u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return send(res, 400, "Neispravan link.");
  }
  if (url.protocol !== "https:" || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return send(res, 400, "Nedozvoljen izvor.");
  try {
    const r = await fetch(url, { headers: { "User-Agent": ig.USER_AGENT, Referer: "https://www.instagram.com/" } });
    if (!r.ok) return send(res, 502, "Slika nije dostupna.");
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return send(res, 502, "Nije slika.");
    send(res, 200, Buffer.from(await r.arrayBuffer()), { "Content-Type": type, "Cache-Control": "private, max-age=3600" });
  } catch {
    send(res, 502, "Slika nije dostupna.");
  }
}

/* ---------- Ruter ---------- */

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const server = http.createServer(async (req, res) => {
  // Zaštita od DNS rebinding napada: server odgovara samo kad se otvori kao localhost.
  if (!ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase()) && !process.env.ZREB_ALLOW_ANY_HOST) {
    return send(res, 403, "Žreb radi samo na adresi localhost.");
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(ROOT, "index.html")), { "Content-Type": "text/html; charset=utf-8" });
    }
    if (!p.startsWith("/api/")) return send(res, 404, "Nije pronađeno.");

    if (req.method === "GET" && p === "/api/status") {
      return send(res, 200, { app: "zreb", version: VERSION, user: session?.loggedIn ? account : null });
    }
    if (req.method === "GET" && p === "/api/img") return proxyImage(res, url.searchParams.get("u"));

    const jobMatch = p.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/comments|\/cancel)?$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(res, 404, { error: "Preuzimanje nije pronađeno.", code: "not_found" });
      if (req.method === "GET" && !jobMatch[2]) return send(res, 200, publicJob(job));
      if (req.method === "GET" && jobMatch[2] === "/comments") return send(res, 200, { posts: job.posts, comments: job.comments });
      if (req.method === "POST" && jobMatch[2] === "/cancel") {
        job.ctl.abort();
        return send(res, 200, { ok: true });
      }
    }

    if (req.method !== "POST") return send(res, 404, { error: "Nepoznata ruta.", code: "not_found" });
    const body = await readJson(req);
    switch (p) {
      case "/api/login":
        return send(res, 200, await handleLogin(body));
      case "/api/login/2fa":
        return send(res, 200, await handleTwoFactor(body));
      case "/api/session":
        return send(res, 200, await handleCookie(body));
      case "/api/logout":
        clearSession();
        return send(res, 200, { ok: true });
      case "/api/scrape":
        return send(res, 200, startJob(body));
      case "/api/follows":
        return send(res, 200, await persistAfter(checkFollows)(body));
      default:
        return send(res, 404, { error: "Nepoznata ruta.", code: "not_found" });
    }
  } catch (e) {
    if (!e.code) console.error(e);
    fail(res, e);
  }
});

// Stari završeni poslovi se brišu posle sat vremena.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 3600e3) jobs.delete(id);
  for (const [id, l] of pendingLogins) if (now - l.at > 15 * 60e3) pendingLogins.delete(id);
}, 60e3).unref();

function openBrowser(u) {
  if (process.argv.includes("--no-open")) return;
  const cmd = process.platform === "win32" ? `start "" "${u}"` : process.platform === "darwin" ? `open "${u}"` : `xdg-open "${u}"`;
  exec(cmd, () => {});
}

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.log(`\n  Žreb već radi na http://localhost:${PORT}/  Otvaram ga u pregledaču.\n`);
    openBrowser(`http://localhost:${PORT}/`);
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error(e);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  const u = `http://localhost:${PORT}/`;
  console.log(`\n  Žreb radi na ${u}`);
  console.log(account ? `  Instagram nalog: @${account.username}` : "  Instagram nalog: nije prijavljen");
  console.log("  Zatvori ovaj prozor (ili Ctrl+C) da ugasiš Žreb.\n");
  openBrowser(u);
});
