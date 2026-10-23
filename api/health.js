// 저장소 연결 점검. 키 값은 절대 내보내지 않고, 모양이 맞는지와 연결 결과만 알려 준다.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = process.env.SUPABASE_URL || "", key = process.env.SUPABASE_SECRET_KEY || "";
  const out = {
    url_set: !!url,
    url_looks_right: /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url.trim()),
    url_has_rest_path: /\/rest\/v1\/?$/i.test(url.trim()),
    key_set: !!key,
    key_kind: key.startsWith("sb_secret_") ? "secret(new)" : key.startsWith("sb_publishable_") ? "publishable(wrong)" : key.split(".").length === 3 ? "jwt(legacy)" : key ? "unknown" : "none",
    key_has_spaces: /\s/.test(key),
    claude_key_set: !!process.env.ANTHROPIC_API_KEY,
    region: process.env.VERCEL_REGION || null
  };
  if (out.url_set && out.key_set) {
    try {
      const h = { apikey: key.trim() };
      if (!key.startsWith("sb_")) h.Authorization = "Bearer " + key.trim();
      const base = url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
      const r = await fetch(base + "/rest/v1/entries?select=id&limit=1", { headers: h });
      out.db_status = r.status;
      if (!r.ok) out.db_error = (await r.text()).slice(0, 200);
    } catch (e) { out.db_status = "fetch_failed"; out.db_error = String(e && e.message || e).slice(0, 200); }
  }
  res.status(200).json(out);
};
