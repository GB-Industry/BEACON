// 텔레그램 안에서 열리는 설정 화면 (Telegram Mini App)
// 주의: 이 파일은 JS 템플릿 문자열이므로 아래 HTML/스크립트 안에서는 백틱과 ${} 를 쓰지 않는다.

export const SETTINGS_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>BEACON 설정</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    --bg: var(--tg-theme-secondary-bg-color, #f2f2f7);
    --card: var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, #ffffff));
    --text: var(--tg-theme-text-color, #111111);
    --hint: var(--tg-theme-hint-color, #8e8e93);
    --accent: var(--tg-theme-button-color, #2481cc);
    --accent-text: var(--tg-theme-button-text-color, #ffffff);
    --danger: var(--tg-theme-destructive-text-color, #e5484d);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 16px 96px;
    background: var(--bg); color: var(--text);
    font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif;
  }
  h1 { font-size: 22px; margin: 4px 4px 2px; }
  .sub { color: var(--hint); font-size: 14px; margin: 0 4px 18px; }
  .label { color: var(--hint); font-size: 13px; text-transform: uppercase; letter-spacing: .02em; margin: 18px 12px 6px; }
  .card { background: var(--card); border-radius: 14px; overflow: hidden; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; min-height: 50px; }
  .row + .row { border-top: 0.5px solid color-mix(in srgb, var(--hint) 35%, transparent); }
  .row small { display: block; color: var(--hint); font-size: 13px; }
  input[type=time] {
    font: inherit; font-size: 20px; font-weight: 600; color: var(--accent);
    background: transparent; border: 0; text-align: right;
  }
  .switch { position: relative; width: 51px; height: 31px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: color-mix(in srgb, var(--hint) 45%, transparent); border-radius: 31px; transition: .2s; }
  .slider::before { content: ""; position: absolute; width: 27px; height: 27px; left: 2px; top: 2px; background: #fff; border-radius: 50%; transition: .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  .switch input:checked + .slider { background: var(--accent); }
  .switch input:checked + .slider::before { transform: translateX(20px); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 16px 4px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 7px 8px 7px 13px;
    border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-weight: 600; font-size: 15px;
  }
  .chip button { border: 0; background: transparent; color: inherit; font-size: 17px; line-height: 1; padding: 0 4px; cursor: pointer; }
  .empty { color: var(--hint); font-size: 14px; padding: 4px 0; }
  .add { display: flex; gap: 8px; padding: 10px 16px 14px; }
  .add input {
    flex: 1; min-width: 0; font: inherit; color: var(--text); padding: 10px 12px; border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--hint) 40%, transparent); background: transparent;
  }
  .btn { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 10px 16px; background: var(--accent); color: var(--accent-text); cursor: pointer; }
  .btn.ghost { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); width: 100%; padding: 14px; }
  input[type=range] { width: 140px; accent-color: var(--accent); }
  .value { font-weight: 700; color: var(--accent); min-width: 28px; text-align: right; }
  .actions { margin-top: 22px; display: grid; gap: 10px; }
  .fallback-save { display: none; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); opacity: 0;
    background: rgba(30,30,30,.92); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 14px; transition: .25s; pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .notice { background: var(--card); border-radius: 14px; padding: 18px; color: var(--hint); }
</style>
</head>
<body>
  <h1>🔆 BEACON</h1>
  <p class="sub">Brief Economic Analysis &amp; Curated Online News<br>원하는 시간과 키워드를 정해 두면 매일 요약해서 보내드려요.</p>

  <div id="app" hidden>
    <div class="label">받는 시간</div>
    <div class="card">
      <div class="row"><span>매일</span><input type="time" id="time" step="300"></div>
      <div class="row"><span>평일에만 받기</span>
        <label class="switch"><input type="checkbox" id="weekdaysOnly"><span class="slider"></span></label></div>
    </div>

    <div class="label">키워드 <span id="kwCount"></span></div>
    <div class="card">
      <div class="chips" id="chips"></div>
      <div class="add">
        <input id="kwInput" placeholder="예: 엔비디아, 코스피" enterkeyhint="done" maxlength="60">
        <button class="btn" id="kwAdd" type="button">추가</button>
      </div>
    </div>

    <div class="label">브리핑 구성</div>
    <div class="card">
      <div class="row"><span>최대 기사 수</span>
        <span style="display:flex;align-items:center;gap:10px"><input type="range" id="maxArticles" min="3" max="20"><span class="value" id="maxArticlesVal"></span></span></div>
      <div class="row"><span>키워드당 기사 수</span>
        <span style="display:flex;align-items:center;gap:10px"><input type="range" id="perKeyword" min="1" max="10"><span class="value" id="perKeywordVal"></span></span></div>
      <div class="row"><span>AI 3줄 요약<small>Claude가 오늘의 흐름을 요약해요</small></span>
        <label class="switch"><input type="checkbox" id="summary"><span class="slider"></span></label></div>
      <div class="row"><span>일시정지<small>켜 두면 정기 브리핑을 보내지 않아요</small></span>
        <label class="switch"><input type="checkbox" id="paused"><span class="slider"></span></label></div>
    </div>

    <div class="actions">
      <button class="btn ghost" id="sendNow" type="button">📰 지금 미리보기 받기</button>
      <button class="btn fallback-save" id="fallbackSave" type="button">저장</button>
    </div>
  </div>

  <div id="notice" class="notice" hidden></div>
  <div class="toast" id="toast"></div>

<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  var MAX_KEYWORDS = 10;
  var settings = null;
  var saving = false;

  function $(id) { return document.getElementById(id); }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function haptic(type) {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type);
  }

  async function api(path, method, body) {
    var res = await fetch(path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
      body: body ? JSON.stringify(body) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function showNotice(text) {
    $('app').hidden = true;
    $('notice').hidden = false;
    $('notice').textContent = text;
  }

  function renderChips() {
    var box = $('chips');
    box.textContent = '';
    if (settings.keywords.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '아직 키워드가 없어요. 아래에서 추가해 주세요.';
      box.appendChild(empty);
    }
    settings.keywords.forEach(function (word) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.appendChild(document.createTextNode('#' + word));
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', word + ' 삭제');
      remove.textContent = '×';
      remove.onclick = function () {
        settings.keywords = settings.keywords.filter(function (k) { return k !== word; });
        renderChips();
      };
      chip.appendChild(remove);
      box.appendChild(chip);
    });
    $('kwCount').textContent = '(' + settings.keywords.length + '/' + MAX_KEYWORDS + ')';
  }

  function addKeywords() {
    var input = $('kwInput');
    var words = input.value.split(/[,，]/).map(function (w) { return w.trim(); }).filter(Boolean);
    words.forEach(function (w) {
      if (settings.keywords.indexOf(w) === -1 && settings.keywords.length < MAX_KEYWORDS) settings.keywords.push(w);
    });
    if (words.length > 0 && settings.keywords.length >= MAX_KEYWORDS) toast('키워드는 최대 ' + MAX_KEYWORDS + '개까지예요');
    input.value = '';
    renderChips();
  }

  function bindRange(id) {
    var el = $(id);
    el.value = settings[id];
    $(id + 'Val').textContent = settings[id];
    el.oninput = function () {
      settings[id] = Number(el.value);
      $(id + 'Val').textContent = el.value;
    };
  }

  function bindSwitch(id) {
    var el = $(id);
    el.checked = settings[id];
    el.onchange = function () { settings[id] = el.checked; };
  }

  function render() {
    $('time').value = settings.time;
    $('time').onchange = function () { if ($('time').value) settings.time = $('time').value.slice(0, 5); };
    ['weekdaysOnly', 'summary', 'paused'].forEach(bindSwitch);
    ['maxArticles', 'perKeyword'].forEach(bindRange);
    renderChips();
    $('app').hidden = false;
  }

  async function save() {
    if (saving) return;
    if ($('kwInput').value.trim()) addKeywords();
    saving = true;
    if (tg.MainButton) tg.MainButton.showProgress(false);
    try {
      var data = await api('/api/settings', 'POST', settings);
      settings = data.settings;
      render();
      haptic('success');
      toast('저장했어요 · 매일 ' + settings.time + (settings.weekdaysOnly ? ' (평일)' : ''));
    } catch (err) {
      haptic('error');
      toast('저장 실패: ' + err.message);
    } finally {
      saving = false;
      if (tg.MainButton) tg.MainButton.hideProgress();
    }
  }

  async function sendNow() {
    try {
      await save();
      await api('/api/send-now', 'POST');
      toast('브리핑을 만들고 있어요. 잠시 후 채팅을 확인하세요!');
    } catch (err) {
      toast('요청 실패: ' + err.message);
    }
  }

  async function init() {
    if (!tg || !tg.initData) {
      showNotice('이 화면은 텔레그램 봇의 "설정" 버튼으로 열어 주세요.');
      return;
    }
    tg.ready();
    tg.expand();
    try {
      var data = await api('/api/settings');
      settings = data.settings;
      render();
    } catch (err) {
      showNotice('설정을 불러오지 못했어요: ' + err.message);
      return;
    }
    $('kwAdd').onclick = addKeywords;
    $('kwInput').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addKeywords(); } };
    $('sendNow').onclick = sendNow;
    if (tg.MainButton && tg.MainButton.setParams) {
      tg.MainButton.setParams({ text: '저장', is_visible: true });
      tg.MainButton.onClick(save);
    } else {
      $('fallbackSave').style.display = 'block';
      $('fallbackSave').onclick = save;
    }
  }

  init();
})();
</script>
</body>
</html>`;