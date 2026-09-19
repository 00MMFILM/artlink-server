export default (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Artlink - 비밀번호 재설정</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #F9F9F9; }
    .container { text-align: center; padding: 40px 24px; max-width: 400px; width: 100%; }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #1C1C1E; margin-bottom: 8px; }
    .desc { font-size: 15px; color: #8E8E93; line-height: 1.5; margin-bottom: 32px; }
    .btn { display: block; width: 100%; padding: 16px; background: #FF2D78; color: #fff; border: none; border-radius: 14px; font-size: 16px; font-weight: 700; cursor: pointer; text-decoration: none; text-align: center; margin-bottom: 12px; -webkit-tap-highlight-color: transparent; }
    .btn:active { opacity: 0.85; }
    .hint { font-size: 13px; color: #AEAEB2; margin-top: 16px; line-height: 1.5; }
    .error { color: #FF3B30; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">&#x1F3A8;</div>
    <h1 id="title">앱을 여는 중...</h1>
    <p class="desc" id="desc">잠시만 기다려주세요.</p>
    <a id="openBtn" class="btn" style="display:none;">Artlink 앱에서 열기</a>
    <p class="hint" id="hint" style="display:none;">버튼을 눌러도 앱이 열리지 않으면<br>Artlink 앱을 최신 버전으로 업데이트해주세요.</p>
    <p class="hint error" id="errorMsg" style="display:none;"></p>
  </div>
  <script>
    (function() {
      var hash = window.location.hash;
      if (!hash || hash.length < 10) {
        document.getElementById('title').textContent = '링크 오류';
        document.getElementById('desc').textContent = '유효하지 않은 링크입니다. 앱에서 다시 시도해주세요.';
        return;
      }

      var appUrl = 'artlink://reset-password' + hash;

      // Try to open app immediately
      var opened = false;
      window.location.href = appUrl;

      // Show fallback button after 1.5 seconds
      setTimeout(function() {
        document.getElementById('title').textContent = '비밀번호 재설정';
        document.getElementById('desc').textContent = '아래 버튼을 눌러 앱에서 비밀번호를 변경해주세요.';
        var btn = document.getElementById('openBtn');
        btn.href = appUrl;
        btn.style.display = 'block';
        document.getElementById('hint').style.display = 'block';
      }, 1500);
    })();
  </script>
</body>
</html>`);
};
