// 지도에 띄울 다른 사람들의 고민. 공유를 켠 글 중 가린 글(masked_text)만 내보낸다.
// 부풀려진 생각(small, pressure)만 내보낸다. 무거운 글(heavy), 위험 신호(risk), 해를 끼친 글(skip), 좋은 일·장난·애매한 글, 신고로 숨긴 글은 내보내지 않는다. (daily, regret은 예전 말투 때 저장된 글) 익명 번호도 내보내지 않는다.
const db = require("./_db");

// 털실 얼굴은 고민마다 정한다 (사람 기준이 아니라서 같은 사람이 쓴 글끼리 묶여 보이지 않는다)
// 이름도 고민마다 새로 뽑는다: 앞은 감정, 뒤는 털실 (화면의 무작위 이름과 같은 낱말). 쓴 사람이 정한 이름은 지도에 내보내지 않는다
const NAME_A = ["시무룩한", "머쓱한", "찜찜한", "뒤척이는", "뾰로통한", "울적한", "속상한", "아리송한", "심란한", "들뜬", "설레는", "멍한"];
const NAME_B = ["털뭉치", "실타래", "실뭉치"];

function nickOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return NAME_A[h % NAME_A.length] + " " + NAME_B[Math.floor(h / NAME_A.length) % NAME_B.length]; }
function faceOf(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 12; }

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ code: "method" });
  if (!db.ready()) return res.status(200).json({ items: [] });
  if (db.tooMany("map:" + db.ipOf(req), 60)) return res.status(429).json({ code: "rate_limited" });
  const anon = String((req.query && req.query.anon) || "");
  try {
    const r = await db.q("GET", "entries?select=id,masked_text,created_at,likes(count)" +
      "&shared=eq.true&hidden=eq.false&masked_text=not.is.null&reply_type=in.(small,pressure,daily,regret)&order=created_at.desc&limit=22");
    const rows = Array.isArray(r.data) ? r.data : [];
    let liked = new Set();
    if (db.isAnon(anon) && rows.length) {
      const l = await db.q("GET", "likes?select=entry_id&anon_id=eq." + encodeURIComponent(anon) + "&entry_id=in.(" + rows.map(function (x) { return x.id; }).join(",") + ")");
      liked = new Set((l.data || []).map(function (x) { return x.entry_id; }));
    }
    const items = rows.map(function (x) {
      return { id: x.id, text: x.masked_text, nick: nickOf(x.id), likes: (x.likes && x.likes[0] && x.likes[0].count) || 0, liked: liked.has(x.id), face: faceOf(x.id), at: x.created_at };
    });
    return res.status(200).json({ items: items });
  } catch (e) {
    return res.status(200).json({ items: [] });
  }
};
