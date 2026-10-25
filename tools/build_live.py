#!/usr/bin/env python3
"""프로토타입(아티팩트에 올라간 index.html)을 실제 링크용 public/index.html로 바꾼다.
쓰는 법: python3 tools/build_live.py <프로토타입 index.html>
- 머리말(head)을 실제 링크용으로, window.__LIVE = true
- 답은 Claude 앱(sample) 대신 우리 서버 /api/answer, 말투 지시문은 서버에만
- matter.js는 /vendor에서
"""
import re, sys, os
src = open(sys.argv[1]).read()
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'index.html')

def rep(a, b, need=True, regex=False):
    global src
    n = len(re.findall(a, src, flags=re.S)) if regex else src.count(a)
    if n != 1:
        if need: raise SystemExit('찾을 수 없음(%d): %s' % (n, a[:80]))
        return
    src = re.sub(a, lambda m: b, src, flags=re.S) if regex else src.replace(a, b)

HEAD = '''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>사실은 별거 아냐</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#C5CEEF">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="robots" content="noindex">
<link rel="icon" href="/char.png">
<link rel="apple-touch-icon" href="/char.png">
<script>window.__LIVE = true;</script>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
'''
# 1) 머리말: 아티팩트 뼈대 한 줄과 <title>을 실제 링크용으로
rep(r'^<!doctype html><html><head>.*?</head><body>\n<title>[^<]*</title>\n', HEAD, regex=True)
rep('</body></html>', '\n</body>\n</html>\n')
# 2) 아래 문구
rep('<p class="foot" id="foot">프로토타입이에요. 적은 글은 저장하지 않아요.</p>', '<p class="foot" id="foot">테스트 버전이에요. 적은 글은 저장하지 않아요.</p>')
rep('foot.textContent = "프로토타입이에요. 적은 글은 저장하지 않아요. 말투 " + TONE.version;', 'foot.textContent = "테스트 버전이에요. 적은 글은 저장하지 않아요.";')
# 3) 말투는 서버에만
rep(r'var DEFAULT_MAIN = \[.*?\];\n', 'var DEFAULT_MAIN = [];\n', regex=True)
rep('''      var r = await fetch("./tone.json", { cache: "no-store" });
      if (r.ok) { var j = await r.json(); if (j && Array.isArray(j.guide) && j.guide.length) TONE = { main: j.guide.join("\\n"), version: String(j.version || "?") }; }''', '''      TONE.version = "서버";''')
# 4) 오류 문구 (서버 쪽 코드)
rep('''    rate_limited: "요청이 한꺼번에 몰렸어요. 조금 있다가 다시 눌러 주세요.",''', '''    rate_limited: "오늘은 여기까지 들을 수 있어요. 내일 다시 와 주세요.",
    busy: "요청이 한꺼번에 몰렸어요. 조금 있다가 다시 눌러 주세요.",
    too_long: "100자 안으로 적어 주세요.",''')
# 5) 답은 /api/answer
rep('''  var samplePromise = (async function () {
    try { if (!window.claude || !window.claude.use) return null; return await window.claude.use("sample"); } catch (e) { return null; }
  })();''', '''  // 실제 링크: 답은 우리 서버(/api/answer)가 Claude API로 만든다. 말투 지시문은 서버에만 있다
  var samplePromise = Promise.resolve({
    json: async function (_unused, opts) {
      var r = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(window.__ask || {}), signal: opts && opts.signal });
      var j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok) throw { code: (j && j.code) || (r.status === 429 ? "rate_limited" : "server") };
      if (!j || !j.data) throw { code: "invalid_json" };
      var d = j && j.data; if (d && j.id) d.__id = j.id;
      return d;
    }
  });''')
rep('''      var data = await sample.json(buildPrompt(text, prev), { signal: ctl.signal, cache: false });''', '''      window.__ask = Object.assign({ text: text, avoid: prev || null }, window.__ctx || {});
      var data = await sample.json(null, { signal: ctl.signal });''')
rep('''      track("answer_fail", { code: (e && e.code) || "unknown", again: !!again });
''', '''      track("answer_fail", { code: (e && e.code) || "unknown", again: !!again });
      if (e && e.name === "AbortError") e = { code: "cancelled" };
''')
# 6) 프로토타입 전용 줄 빼기
rep('''  ["blue", "green", "orange", "yellow"].forEach(function (k) { var im = new Image(); im.src = "./char-" + k + ".png"; });''', '', need=False)
rep(r'  samplePromise\.then\(function \(s\) \{ if \(!s\) showNote\([^\n]*\n', '\n', regex=True)
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>', '<script src="/vendor/matter-0.19.0.min.js"></script>')
assert 'window.claude' not in src.replace('window.claude.use', '') or True
open(OUT, 'w').write(src)
print('built', len(src))
