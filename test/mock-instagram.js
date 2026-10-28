/**
 * Lažni Instagram server za testove. Oponaša odgovore instagram.com endpoint-a koje Žreb koristi:
 * kolačiće, prijavu sa 2FA, podatke o objavi, paginaciju komentara (min_id), odgovore, 429 i pretragu pratilaca.
 */
import http from "node:http";
import { shortcodeToId } from "../scraper/instagram.js";

export const CODE = "DA1b2C3d4E5";
export const MEDIA_ID = shortcodeToId(CODE);
export const TOTAL = 260;
const PAGE = 15;

export function createMock() {
  const users = Array.from({ length: 120 }, (_, i) => `user${i}`);
  const comments = Array.from({ length: TOTAL }, (_, i) => ({
    pk: String(9000 + i),
    text: `@friend${i} @friend${i + 1} bravo`,
    created_at: 1767225600 + i * 60,
    user: { pk: String(100 + (i % users.length)), username: users[i % users.length] },
    child_comment_count: i % 40 === 0 ? 5 : 0,
    preview_child_comments: i % 40 === 0 ? [{ pk: `r${i}-0`, text: "@a @b", created_at: 1767225600, user: { pk: "1", username: `rep${i}a` } }] : [],
  }));
  const log = [];
  let threw429 = false;
  const json = (res, status, data, cookies = []) => {
    res.writeHead(status, { "Content-Type": "application/json", "Set-Cookie": cookies });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const ck = req.headers.cookie || "";
    const authed = /sessionid=123%3Aabc/.test(ck);
    log.push(`${req.method} ${p}${url.search}`);
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      if (p === "/") {
        res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": ["csrftoken=csrf123; Path=/", "mid=mid1; Path=/"] });
        return res.end("<html>Instagram</html>");
      }
      if (p.startsWith("/p/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<html><body><h1>Objava</h1><script>var x={"media_id":"${MEDIA_ID}"}</script></body></html>`);
      }
      if (p === "/api/v1/web/accounts/login/ajax/") {
        if (req.headers["x-csrftoken"] !== "csrf123") return json(res, 403, { message: "CSRF", status: "fail" });
        const pw = form.get("enc_password") || "";
        if (!/^#PWD_INSTAGRAM_BROWSER:0:\d+:/.test(pw)) return json(res, 400, { status: "fail", message: "bad format" });
        const pass = pw.split(":").slice(3).join(":");
        const u = form.get("username");
        if (u === "nepostoji") return json(res, 200, { authenticated: false, user: false, status: "ok" });
        if (pass !== "lozinka") return json(res, 200, { authenticated: false, user: true, status: "ok" });
        if (u === "tf")
          return json(res, 400, { two_factor_required: true, two_factor_info: { two_factor_identifier: "ID42", sms_two_factor_on: true, obfuscated_phone_number: "••••1234" }, status: "fail" });
        return json(res, 200, { authenticated: true, userId: "123", status: "ok" }, ["sessionid=123%3Aabc; Path=/; HttpOnly", "ds_user_id=123; Path=/"]);
      }
      if (p === "/api/v1/web/accounts/login/ajax/two_factor/") {
        if (form.get("identifier") !== "ID42" || form.get("verificationCode") !== "123456")
          return json(res, 400, { status: "fail", error_type: "sms_code_validation_code_invalid", message: "Please check the code" });
        return json(res, 200, { authenticated: true, userId: "123", status: "ok" }, ["sessionid=123%3Aabc; Path=/; HttpOnly", "ds_user_id=123; Path=/"]);
      }
      if (!authed && p.startsWith("/api/")) return json(res, 401, { message: "login_required", status: "fail" });
      if (p === "/api/v1/accounts/edit/web_form_data/") return json(res, 200, { form_data: { username: "tester" }, status: "ok" });
      if (p === `/api/v1/media/${MEDIA_ID}/info/`)
        return json(res, 200, {
          items: [{ pk: MEDIA_ID, code: CODE, user: { pk: "999", username: "pekara.zrno" }, caption: { text: "Nagradna igra" }, comment_count: TOTAL, image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/x.jpg", width: 640 }] } }],
          status: "ok",
        });
      if (p.startsWith("/api/v1/media/") && p.endsWith("/info/")) return json(res, 400, { message: "Media not found or unavailable", status: "fail" });
      if (p === `/api/v1/media/${MEDIA_ID}/comments/`) {
        if (url.searchParams.get("can_support_threading") !== "true") return json(res, 400, { status: "fail" });
        const cur = url.searchParams.get("min_id");
        const off = cur ? JSON.parse(cur).offset : 0;
        if (off === PAGE * 3 && !threw429) {
          threw429 = true;
          return json(res, 429, { message: "Please wait a few minutes before you try again.", status: "fail" });
        }
        const slice = comments.slice(off, off + PAGE);
        const more = off + PAGE < comments.length;
        return json(res, 200, {
          comments: slice,
          comment_count: TOTAL,
          has_more_headload_comments: more,
          next_min_id: more ? JSON.stringify({ offset: off + PAGE }) : undefined,
          status: "ok",
        });
      }
      const cm = p.match(new RegExp(`^/api/v1/media/${MEDIA_ID}/comments/(\\d+)/child_comments/$`));
      if (cm) {
        const pk = cm[1];
        const i = +pk - 9000;
        const all = Array.from({ length: 5 }, (_, k) => ({ pk: `r${i}-${k}`, text: `odgovor ${k}`, created_at: 1767225600, user: { pk: "2", username: `rep${i}${"abcde"[k]}` } }));
        const off = url.searchParams.get("max_id") ? 3 : 0;
        return json(res, 200, {
          child_comments: all.slice(off, off + 3),
          has_more_tail_child_comments: off === 0,
          next_max_child_cursor: off === 0 ? "cur3" : undefined,
          status: "ok",
        });
      }
      if (p === "/api/v1/users/web_profile_info/") {
        const u = url.searchParams.get("username");
        if (u === "pekara.zrno") return json(res, 200, { data: { user: { id: "999", username: u, is_private: false, followed_by_viewer: false } }, status: "ok" });
        if (u === "tajni") return json(res, 200, { data: { user: { id: "777", username: u, is_private: true, followed_by_viewer: false } }, status: "ok" });
        return json(res, 404, { message: "User not found", status: "fail" });
      }
      if (p === "/api/v1/friendships/999/followers/") {
        const q = url.searchParams.get("query") || "";
        const n = parseInt(q.replace(/\D/g, ""), 10);
        // Prate samo korisnici sa parnim brojem; vraćaju se i slična imena kao na pravom Instagramu.
        const list = [{ username: q + "_fan" }];
        if (!isNaN(n) && n % 2 === 0) list.push({ username: q });
        return json(res, 200, { users: list, status: "ok" });
      }
      json(res, 404, { message: "not found", status: "fail" });
    });
  });
  return { server, log, comments };
}
