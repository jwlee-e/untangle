// Supabase 저장소에 서버에서만 접근한다. 비밀 키는 Vercel 환경 변수에만 있고 화면에는 절대 내려가지 않는다.
// 표의 보안 설정(RLS)이 켜져 있어서, 이 비밀 키 말고는 아무도 읽거나 쓸 수 없다.
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || "";

function ready() { return !!(URL_ && KEY); }

function headers(extra) {
  const h = { apikey: KEY, "Content-Type": "application/json" };
  // 예전 방식(service_role, JWT) 키는 Authorization에도 넣어야 한다. 새 방식(sb_secret_) 키는 apikey만
  if (!KEY.startsWith("sb_")) h.Authorization = "Bearer " + KEY;
  return Object.assign(h, extra || {});
}

async function q(method, path, body, extra) {
  if (!ready()) return { ok: false, status: 0, data: null };
  const r = await fetch(URL_ + "/rest/v1/" + path, { method: method, headers: headers(extra), body: body == null ? undefined : JSON.stringify(body) });
  let data = null;
  const txt = await r.text();
  if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
  return { ok: r.ok, status: r.status, data: data, range: r.headers.get("content-range") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANON = /^[A-Za-z0-9_-]{6,64}$/;
function isUuid(s) { return typeof s === "string" && UUID.test(s); }
function isAnon(s) { return typeof s === "string" && ANON.test(s); }

// 지도에 보여 줄 글에서 연락처·이메일·긴 숫자를 한 번 더 가린다 (이름·상호는 AI가 먼저 가린다)
function mask(s) {
  return String(s || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "○○○")
    .replace(/(https?:\/\/|www\.)\S+/gi, "○○○")
    .replace(/\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "○○○")
    .replace(/\d{6,}/g, "○○○")
    .replace(/@[A-Za-z0-9_.]{3,}/g, "○○○");
}

function readBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

// 아주 단순한 분당 제한 (서버 한 대 기준)
const buckets = new Map();
function tooMany(key, perMin) {
  const m = Math.floor(Date.now() / 60000), k = m + ":" + key, n = (buckets.get(k) || 0) + 1;
  buckets.set(k, n);
  if (buckets.size > 5000) for (const x of buckets.keys()) if (!x.startsWith(m + ":")) buckets.delete(x);
  return n > perMin;
}
function ipOf(req) { return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown"; }

module.exports = { ready, q, isUuid, isAnon, mask, readBody, tooMany, ipOf };
