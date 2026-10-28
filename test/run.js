/**
 * Testovi Žreba bez interneta: pokreće lažni Instagram i pravi Žreb server, pa prolazi ceo tok.
 *   npm test
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMock, CODE, MEDIA_ID, TOTAL } from "./mock-instagram.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = 9911, APP_PORT = 4799;
const base = `http://localhost:${APP_PORT}`;
let passed = 0;
const ok = name => { passed++; console.log("  ✓ " + name); };

const { server: mock, log } = createMock();
await new Promise(r => mock.listen(MOCK_PORT, r));
fs.rmSync(path.join(ROOT, ".zreb"), { recursive: true, force: true });
const app = spawn(process.execPath, ["server.js", "--no-open"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(APP_PORT), ZREB_IG_BASE: `http://localhost:${MOCK_PORT}`, ZREB_PACE: "0" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise(r => app.stdout.on("data", d => /radi na/.test(d) && r()));

const api = async (p, body) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};

try {
  console.log("\nŽreb testovi");
  assert.match(MEDIA_ID, /^\d{15,}$/); ok("kod objave u ID (" + MEDIA_ID + ")");
  let r = await api("/api/status");
  assert.equal(r.data.app, "zreb"); assert.equal(r.data.user, null); ok("status bez prijave");

  r = await api("/api/scrape", { urls: [`https://www.instagram.com/p/${CODE}/`] });
  assert.equal(r.status, 401); ok("preuzimanje traži prijavu");

  r = await api("/api/login", { username: "tester", password: "pogresna" });
  assert.equal(r.status, 400); assert.match(r.data.error, /Pogrešna lozinka/); ok("pogrešna lozinka");

  r = await api("/api/login", { username: "nepostoji", password: "lozinka" });
  assert.match(r.data.error, /ne postoji/); ok("nepostojeći nalog");

  r = await api("/api/login", { username: "tf", password: "lozinka" });
  assert.equal(r.data.status, "two_factor"); assert.match(r.data.method, /1234/);
  const loginId = r.data.loginId;
  r = await api("/api/login/2fa", { loginId, code: "000000" });
  assert.equal(r.status, 400); assert.match(r.data.error, /Kod/);
  r = await api("/api/login/2fa", { loginId, code: "123 456" });
  assert.equal(r.data.status, "ok"); assert.equal(r.data.user.username, "tester"); ok("prijava sa 2FA kodom");
  assert.ok(fs.existsSync(path.join(ROOT, ".zreb/session.json"))); ok("sesija sačuvana lokalno");

  r = await api("/api/scrape", { urls: ["https://google.com/x"] });
  assert.equal(r.status, 400); ok("odbija link koji nije Instagram");

  r = await api("/api/scrape", { urls: [`https://instagram.com/pekara.zrno/reel/${CODE}/?igsh=abc`], replies: true });
  assert.equal(r.data.status, "running");
  const id = r.data.id;
  let j;
  for (let i = 0; i < 200; i++) { j = (await api("/api/jobs/" + id)).data; if (j.status !== "running") break; await new Promise(x => setTimeout(x, 50)); }
  assert.equal(j.status, "done", j.error);
  const { data } = await api(`/api/jobs/${id}/comments`);
  const top = data.comments.filter(c => !c.isReply), reps = data.comments.filter(c => c.isReply);
  assert.equal(top.length, TOTAL); ok(`svih ${TOTAL} komentara kroz ${Math.ceil(TOTAL / 15)} strana`);
  assert.ok(log.some(l => /min_id=/.test(l))); ok("paginacija preko min_id");
  assert.equal(new Set(data.comments.map(c => c.id)).size, data.comments.length); ok("bez duplikata posle 429 ponavljanja");
  assert.equal(reps.length, 7 * 5); ok("odgovori iz svih niti (pregled + child_comments sa kursorom)");
  assert.equal(data.posts[0].owner, "pekara.zrno"); assert.equal(data.posts[0].commentCount, TOTAL); ok("podaci o objavi i vlasnik");
  assert.ok(top[0].timestamp && top[0].username === "user0" && /@friend0/.test(top[0].text)); ok("format komentara");

  r = await api("/api/follows", { usernames: ["user2", "user3", "pekara.zrno"], accounts: ["@pekara.zrno"] });
  assert.equal(r.data.results.user2["pekara.zrno"], true);
  assert.equal(r.data.results.user3["pekara.zrno"], false);
  assert.equal(r.data.results["pekara.zrno"]["pekara.zrno"], true); ok("provera praćenja (tačno ime, ne slično)");

  r = await api("/api/follows", { usernames: ["user2"], accounts: ["tajni", "nema.ga"] });
  assert.equal(r.data.results.user2.tajni, null);
  assert.equal(r.data.accounts.find(a => a.username === "tajni").private, true);
  assert.equal(r.data.accounts.find(a => a.username === "nema.ga").ok, false); ok("privatan i nepostojeći nalog");

  const badStatus = await new Promise(res => http.get({ host: "127.0.0.1", port: APP_PORT, path: "/api/status", headers: { Host: "evil.com" } }, r => { r.resume(); res(r.statusCode); }));
  assert.equal(badStatus, 403); ok("odbija tuđi Host (DNS rebinding)");
  const form = await fetch(base + "/api/logout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" });
  assert.equal(form.status, 400); ok("POST bez JSON-a se ne izvršava");

  r = await api("/api/logout", {});
  r = await api("/api/status"); assert.equal(r.data.user, null); assert.ok(!fs.existsSync(path.join(ROOT, ".zreb/session.json"))); ok("odjava briše sesiju");

  r = await api("/api/session", { sessionid: "123%3Aabc" });
  assert.equal(r.data.user.username, "tester"); ok("prijava kolačićem sessionid");
  await api("/api/logout", {});

  console.log(`\n${passed} testova je prošlo.\n`);
} catch (e) {
  console.error("\n  ✗ " + e.message + "\n");
  process.exitCode = 1;
} finally {
  app.kill(); mock.close();
  fs.rmSync(path.join(ROOT, ".zreb"), { recursive: true, force: true });
}
