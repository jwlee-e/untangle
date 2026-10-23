// 화면에서 일어난 일을 저장한다: 이용 기록, 설문, 공감, 신고, 공유 켬/끔.
// 이용 기록에는 적은 글 내용을 넣지 않는다 (이름과 몇 가지 숫자만).
const db = require("./_db");

const NAME = /^[a-z_]{2,32}$/;
function cleanProps(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const out = {};
  Object.keys(p).slice(0, 8).forEach(function (k) {
    if (!/^[a-z_]{1,20}$/.test(k) || k === "text") return;
    const v = p[k];
    if (typeof v === "number" && isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 24) out[k] = v;
  });
  return Object.keys(out).length ? out : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ code: "method" });
  if (!db.ready()) return res.status(200).json({ ok: false, code: "no_db" });
  const b = db.readBody(req), anon = b.anon;
  if (!db.isAnon(anon)) return res.status(400).json({ code: "anon" });
  if (db.tooMany("act:" + db.ipOf(req), 240)) return res.status(429).json({ code: "rate_limited" });

  try {
    if (b.a === "events") {
      const rows = (Array.isArray(b.events) ? b.events : []).slice(0, 50)
        .filter(function (e) { return e && NAME.test(e.name); })
        .map(function (e) {
          const t = Number(e.t), when = isFinite(t) && Math.abs(Date.now() - t) < 864e5 ? new Date(t).toISOString() : new Date().toISOString();
          return { anon_id: anon, name: e.name, props: cleanProps(e.props), created_at: when };
        });
      if (rows.length) await db.q("POST", "events", rows, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "survey") {
      const a = cleanProps(b.answers);
      if (!a) return res.status(400).json({ code: "empty" });
      await db.q("POST", "surveys", { anon_id: anon, answers: a }, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "like" || b.a === "unlike") {
      if (!db.isUuid(b.entry)) return res.status(400).json({ code: "entry" });
      if (b.a === "like") await db.q("POST", "likes", { entry_id: b.entry, anon_id: anon }, { Prefer: "resolution=ignore-duplicates,return=minimal" });
      else await db.q("DELETE", "likes?entry_id=eq." + b.entry + "&anon_id=eq." + encodeURIComponent(anon), null, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "report") {
      if (!db.isUuid(b.entry)) return res.status(400).json({ code: "entry" });
      const mine = await db.q("GET", "reports?select=id&entry_id=eq." + b.entry + "&anon_id=eq." + encodeURIComponent(anon) + "&limit=1");
      if (!(mine.data && mine.data.length)) await db.q("POST", "reports", { entry_id: b.entry, anon_id: anon }, { Prefer: "return=minimal" });
      // 서로 다른 사람 세 명이 신고하면 모두에게서 숨긴다
      const all = await db.q("GET", "reports?select=anon_id&entry_id=eq." + b.entry);
      const who = new Set((all.data || []).map(function (r) { return r.anon_id; }));
      if (who.size >= 3) await db.q("PATCH", "entries?id=eq." + b.entry, { hidden: true }, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "share") {
      // 공유를 끄면 지금까지 적은 고민도 지도에서 모두 내린다
      await db.q("PATCH", "entries?anon_id=eq." + encodeURIComponent(anon), { shared: !!b.on }, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ code: "action" });
  } catch (e) {
    return res.status(502).json({ code: "server" });
  }
};
