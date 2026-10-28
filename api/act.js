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
      // 새 설문(v2): 표정 1~5 + 좋았던 점·아쉬웠던 점(정해 둔 값만) + 기타에 적은 말(200자까지)
      const s = b.answers || {};
      if (s.v === 2) {
        const GOOD = ["lighter", "sorted", "relate", "relief", "easy", "etc"], BAD = ["mismatch", "obvious", "empathy", "real", "blank", "hard", "etc"];
        const score = Number(s.score);
        if (!(score >= 1 && score <= 5 && Math.round(score) === score)) return res.status(400).json({ code: "score" });
        const pick = function (arr, ok) { return Array.isArray(arr) ? arr.filter(function (x, i, all) { return ok.indexOf(x) >= 0 && all.indexOf(x) === i; }) : []; };
        const row = { v: 2, score: score, good: pick(s.good, GOOD), bad: pick(s.bad, BAD) };
        ["note", "note_good", "note_bad"].forEach(function (k) { if (typeof s[k] === "string" && s[k].trim()) row[k] = s[k].trim().slice(0, 200); });
        await db.q("POST", "surveys", { anon_id: anon, answers: row }, { Prefer: "return=minimal" });
        return res.status(200).json({ ok: true });
      }
      const a = cleanProps(b.answers);
      if (!a) return res.status(400).json({ code: "empty" });
      await db.q("POST", "surveys", { anon_id: anon, answers: a }, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "feedback") {
      // 도움이 안 됐어요: 고른 이유와 (선택) 한마디. 설문 표에 같이 남긴다
      const reasons = ["내 상황이랑 달라요", "너무 뻔해요", "더 공감해 줬으면", "말투가 별로예요", "기타"];
      if (reasons.indexOf(b.reason) < 0) return res.status(400).json({ code: "reason" });
      const answers = { kind: "answer_feedback", reason: b.reason, note: String(b.note || "").slice(0, 200), type: String(b.type || "").slice(0, 16), entry: db.isUuid(b.entry) ? b.entry : null };
      await db.q("POST", "surveys", { anon_id: anon, answers: answers }, { Prefer: "return=minimal" });
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
      // 신고 사유는 정해 둔 것 중 하나만 받는다. reason 칸이 아직 없으면(SQL 실행 전) 사유 없이 저장한다
      const REASONS = ["누군지 알아볼 수 있는 정보가 있어요", "욕설이나 혐오 표현이 있어요", "광고나 도배 같아요", "위험해 보여요, 도움이 필요해 보여요", "기타"];
      const reason = REASONS.indexOf(b.reason) >= 0 ? b.reason : null;
      // 기타를 고르면 적은 말(200자까지)도 남긴다. note 칸이 없으면(SQL 실행 전) 빼고 저장한다
      const note = reason === "기타" && typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 200) : null;
      if (!(mine.data && mine.data.length)) {
        const row = { entry_id: b.entry, anon_id: anon };
        if (reason) row.reason = reason;
        if (note) row.note = note;
        let w = await db.q("POST", "reports", row, { Prefer: "return=minimal" });
        if (!w.ok && note) { delete row.note; w = await db.q("POST", "reports", row, { Prefer: "return=minimal" }); }
        if (!w.ok && reason) await db.q("POST", "reports", { entry_id: b.entry, anon_id: anon }, { Prefer: "return=minimal" });
      }
      // 서로 다른 사람 세 명이 신고하면 모두에게서 숨긴다
      const all = await db.q("GET", "reports?select=anon_id&entry_id=eq." + b.entry);
      const who = new Set((all.data || []).map(function (r) { return r.anon_id; }));
      if (who.size >= 3) await db.q("PATCH", "entries?id=eq." + b.entry, { hidden: true }, { Prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.a === "block") {
      // 차단: 그 고민을 쓴 사람의 익명 번호를 서버에만 적어 두고, 지도에서 그 사람의 고민을 모두 뺀다 (번호는 화면에 내려가지 않는다)
      if (!db.isUuid(b.entry)) return res.status(400).json({ code: "entry" });
      const e = await db.q("GET", "entries?select=anon_id&id=eq." + b.entry + "&limit=1");
      const who = e.data && e.data[0] && e.data[0].anon_id;
      if (who && who !== anon) await db.q("POST", "blocks", { anon_id: anon, blocked_anon: who }, { Prefer: "resolution=ignore-duplicates,return=minimal" });
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
