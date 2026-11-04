// Life Compass Coach 本体
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// =========================================================
// 保存（設定・記録は localStorage、録音は IndexedDB）
// =========================================================
const STORE_KEY = 'lcc-state-v1';

function defaultState() {
  return {
    v: 1,
    onboarded: false,
    goal: null,            // { text, theme, createdAt }
    affirmations: [],      // { id, text, theme, source: 'template'|'custom', active }
    sessions: [],          // { date, type: 'morning'|'night', at }
    journal: [],           // { date, mood, note, at }
    settings: { bgm: 'space', bgmVolume: 0.5, voiceVolume: 1, meditationMinutes: 5 },
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) { console.warn('state load failed', e); }
  return defaultState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('保存できませんでした。ブラウザの保存領域を確認してください'); }
}

const RecDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('lcc', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recordings');
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('recordings', mode);
      const req = fn(t.objectStore('recordings'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  },
  get(id) { return this.tx('readonly', s => s.get(id)).catch(() => null); },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  keys() { return this.tx('readonly', s => s.getAllKeys()).catch(() => []); },
  clear() { return this.tx('readwrite', s => s.clear()); },
};

let recordedIds = new Set();
async function refreshRecorded() { recordedIds = new Set(await RecDB.keys()); }

// 生成済み音声の一覧（tools/generate_audio.py が作る）
let audioManifest = { voice: null, affirmations: {}, guide: {}, bgm: [] };
async function loadAudioManifest() {
  try {
    const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
    if (r.ok) audioManifest = { ...audioManifest, ...(await r.json()) };
  } catch (e) { /* 未生成なら文字表示で進める */ }
}

// =========================================================
// 日付・集計
// =========================================================
// 深夜4時までは前日扱い（夜のルーティンが日付をまたいでも同じ日にする）
function dayKey(d = new Date()) {
  const x = new Date(d);
  if (x.getHours() < 4) x.setDate(x.getDate() - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const doneToday = type => state.sessions.some(s => s.date === dayKey() && s.type === type);
const starCount = () => state.sessions.length;

function addSession(type) {
  if (doneToday(type)) return false;
  state.sessions.push({ date: dayKey(), type, at: Date.now() });
  save();
  return true;
}

function constellationInfo(n = starCount()) {
  const index = Math.floor(n / STARS_PER_CONSTELLATION);
  return { index, lit: n % STARS_PER_CONSTELLATION, completed: index };
}
const constellationName = i => CONSTELLATION_NAMES[i] || `星座 ${i + 1}`;

// =========================================================
// 星座の形（番号から毎回同じ形を作る）
// =========================================================
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function constellationShape(index) {
  const r = rng(index * 97 + 13);
  const pts = [];
  let guard = 0;
  while (pts.length < STARS_PER_CONSTELLATION && guard++ < 500) {
    const p = { x: 0.12 + r() * 0.76, y: 0.12 + r() * 0.76, size: 0.7 + r() * 0.6 };
    if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 0.2)) pts.push(p);
  }
  // 最小全域木でつなぐと星座らしい線になる
  const edges = [];
  const inTree = new Set([0]);
  while (inTree.size < pts.length) {
    let best = null;
    inTree.forEach(i => pts.forEach((p, j) => {
      if (inTree.has(j)) return;
      const d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
      if (!best || d < best.d) best = { i, j, d };
    }));
    edges.push([best.i, best.j]);
    inTree.add(best.j);
  }
  // 点灯順は線をたどる順にする
  const order = [0, ...edges.map(e => e[1])];
  return { pts: order.map(i => pts[i]), edges: edges.map(([a, b]) => [order.indexOf(a), order.indexOf(b)]) };
}

// =========================================================
// 夜空キャンバス
// =========================================================
function makeSky(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const r = rng(7);
  const bg = Array.from({ length: opts.density || 160 }, () => ({
    x: r(), y: r(), s: r() * 1.3 + 0.2, p: r() * Math.PI * 2, sp: 0.4 + r() * 1.2,
  }));
  let raf = 0, w = 0, h = 0, running = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function glow(x, y, rad, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${color},${alpha})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }

  function frame(t) {
    ctx.clearRect(0, 0, w, h);
    const time = t / 1000;
    bg.forEach(s => {
      const a = reduce ? 0.6 : 0.35 + 0.35 * Math.sin(time * s.sp + s.p);
      ctx.fillStyle = `rgba(220,228,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.s, 0, Math.PI * 2); ctx.fill();
    });
    if (opts.draw) opts.draw(ctx, w, h, time, glow);
    if (running && !reduce) raf = requestAnimationFrame(frame);
  }

  resize();
  const ro = new ResizeObserver(() => { resize(); if (reduce) frame(0); });
  ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  return { stop() { running = false; cancelAnimationFrame(raf); ro.disconnect(); }, redraw: () => frame(performance.now()) };
}

// 星座を描く（area: 描画範囲 {x,y,w,h}、lit: 点灯数、highlight: 最後に灯った星を強調）
function drawConstellation(ctx, area, index, lit, time, glow, opts = {}) {
  const shape = constellationShape(index);
  const P = shape.pts.map(p => ({ x: area.x + p.x * area.w, y: area.y + p.y * area.h, size: p.size }));
  ctx.lineWidth = opts.lineWidth || 1.2;
  shape.edges.forEach(([a, b]) => {
    const on = a < lit && b < lit;
    ctx.strokeStyle = on ? 'rgba(255,217,138,0.55)' : 'rgba(160,175,230,0.12)';
    ctx.setLineDash(on ? [] : [3, 5]);
    ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
  });
  ctx.setLineDash([]);
  const scale = opts.scale || 1;
  P.forEach((p, i) => {
    if (i < lit) {
      const pulse = 1 + 0.12 * Math.sin(time * 2 + i);
      const isNew = opts.highlight && i === lit - 1;
      glow(p.x, p.y, (isNew ? 26 : 14) * p.size * scale * pulse, '255,217,138', isNew ? 0.55 : 0.35);
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * p.size * scale, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(180,195,240,0.35)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * scale, 0, Math.PI * 2); ctx.stroke();
    }
  });
}

// 北極星
function drawPolaris(ctx, x, y, time, glow, size = 1) {
  const pulse = 1 + 0.08 * Math.sin(time * 1.4);
  glow(x, y, 46 * size * pulse, '170,200,255', 0.35);
  glow(x, y, 18 * size, '255,255,255', 0.6);
  ctx.strokeStyle = 'rgba(235,242,255,0.85)';
  ctx.lineWidth = 1;
  const L = 22 * size * pulse, l = 9 * size;
  ctx.beginPath();
  ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
  ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
  ctx.moveTo(x - l, y - l); ctx.lineTo(x + l, y + l);
  ctx.moveTo(x - l, y + l); ctx.lineTo(x + l, y - l);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, 3.2 * size, 0, Math.PI * 2); ctx.fill();
}

// =========================================================
// 画面切り替え
// =========================================================
let activeSky = null;
const view = $('#view');

function route() {
  if (activeSky) { activeSky.stop(); activeSky = null; }
  const hash = location.hash.slice(1) || 'home';
  if (!state.onboarded && !hash.startsWith('welcome')) { location.replace('#welcome'); return; }
  const [name, arg] = hash.split('/');
  const screens = { home: renderHome, words: renderWords, records: renderRecords, settings: renderSettings, goal: renderGoal, welcome: renderWelcome };
  (screens[name] || renderHome)(arg);
  const tabbar = $('#tabbar');
  tabbar.hidden = name === 'welcome';
  $$('a', tabbar).forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// =========================================================
// はじめての設定
// =========================================================
let draft = null;

function renderWelcome(step = '1') {
  if (!draft) draft = { goal: state.goal?.text || '', theme: state.goal?.theme || 'self', picks: new Set() };
  if (step === '1') {
    view.innerHTML = `
      <section class="screen welcome">
        <div class="welcome-mark" aria-hidden="true">✦</div>
        <h1 class="brand">Life Compass Coach</h1>
        <p class="lead">あなたの目標を<strong>北極星</strong>に。<br>朝と夜のルーティンを重ねるたびに、<br>夜空に星がひとつずつ灯ります。</p>
        <ol class="flow">
          <li><span>☀</span><div><b>朝</b>　呼吸 → 目標を思い描く → アファメーション<small>約4分</small></div></li>
          <li><span>☾</span><div><b>夜</b>　瞑想 → 一日のふり返り<small>約5〜10分</small></div></li>
        </ol>
        <p class="note">${esc(DISCLAIMER)}</p>
        <a class="primary-btn" href="#welcome/2">はじめる</a>
      </section>`;
  } else if (step === '2') {
    view.innerHTML = `
      <section class="screen">
        <p class="step-label">1 / 2</p>
        <h2>あなたの北極星（目標）は？</h2>
        <p class="sub">迷ったときに見上げる、目指す方向を一文で。あとから変えられます。</p>
        <textarea id="goal-text" rows="3" maxlength="60" placeholder="例：自分らしく働き、毎日を笑顔で過ごす">${esc(draft.goal)}</textarea>
        <h3>いちばん近いテーマ</h3>
        <div class="theme-grid">
          ${Object.entries(THEMES).map(([k, t]) => `
            <label class="theme-chip"><input type="radio" name="theme" value="${k}" ${draft.theme === k ? 'checked' : ''}>
              <span><i>${t.icon}</i>${t.name}</span></label>`).join('')}
        </div>
        <button class="primary-btn" id="next">次へ</button>
      </section>`;
    $('#next').onclick = () => {
      const text = $('#goal-text').value.trim();
      if (!text) { toast('目標をひとこと書いてみましょう'); $('#goal-text').focus(); return; }
      draft.goal = text;
      draft.theme = $('input[name=theme]:checked').value;
      draft.picks = new Set(AFFIRMATION_TEMPLATES.filter(a => a.theme === draft.theme).slice(0, 3).map(a => a.id));
      location.hash = '#welcome/3';
    };
  } else {
    const list = [...AFFIRMATION_TEMPLATES].sort((a, b) => (a.theme === draft.theme ? -1 : 0) - (b.theme === draft.theme ? -1 : 0));
    view.innerHTML = `
      <section class="screen">
        <p class="step-label">2 / 2</p>
        <h2>朝に唱えることばを選ぶ</h2>
        <p class="sub">3〜5個がおすすめです。自分で書いたことばは「ことば」タブから追加でき、自分の声で録音もできます。</p>
        <div class="pick-list">
          ${list.map(a => `
            <label class="pick"><input type="checkbox" value="${a.id}" ${draft.picks.has(a.id) ? 'checked' : ''}>
              <span><em>${THEMES[a.theme].icon}</em>${esc(a.text)}</span></label>`).join('')}
        </div>
        <div class="sticky-foot"><button class="primary-btn" id="done">夜空をひらく</button></div>
      </section>`;
    $$('.pick input').forEach(cb => cb.onchange = () => cb.checked ? draft.picks.add(cb.value) : draft.picks.delete(cb.value));
    $('#done').onclick = () => {
      if (!draft.picks.size) { toast('ことばを1つ以上選んでください'); return; }
      state.goal = { text: draft.goal, theme: draft.theme, createdAt: Date.now() };
      const keepCustom = state.affirmations.filter(a => a.source === 'custom');
      state.affirmations = [
        ...AFFIRMATION_TEMPLATES.filter(t => draft.picks.has(t.id)).map(t => ({ ...t, source: 'template', active: true })),
        ...keepCustom,
      ];
      state.onboarded = true;
      save();
      draft = null;
      location.hash = '#home';
    };
  }
}

// =========================================================
// ホーム（夜空）
// =========================================================
function renderHome() {
  const n = starCount();
  const c = constellationInfo(n);
  const hour = new Date().getHours();
  const suggest = hour >= 4 && hour < 15 ? 'morning' : 'night';
  const mDone = doneToday('morning'), nDone = doneToday('night');
  view.innerHTML = `
    <section class="home">
      <canvas id="sky" aria-label="夜空。北極星と、集めた星"></canvas>
      <div class="polaris-label">
        <span class="kicker">北極星</span>
        <a href="#goal" class="goal-text">${esc(state.goal?.text || '目標を設定する')}</a>
      </div>
      <div class="const-label">
        <span>${esc(constellationName(c.index))}</span>
        <span class="count">${c.lit} / ${STARS_PER_CONSTELLATION}</span>
      </div>
      <div class="home-actions">
        <button class="routine-btn ${suggest === 'morning' ? 'suggest' : ''} ${mDone ? 'done' : ''}" data-routine="morning">
          <span class="ri">☀</span><span><b>朝のルーティン</b><small>${mDone ? '今日の星は灯っています ✓' : '呼吸・目標・アファメーション　約4分'}</small></span>
        </button>
        <button class="routine-btn ${suggest === 'night' ? 'suggest' : ''} ${nDone ? 'done' : ''}" data-routine="night">
          <span class="ri">☾</span><span><b>夜のルーティン</b><small>${nDone ? '今日の星は灯っています ✓' : `瞑想・ふり返り　約${state.settings.meditationMinutes + 2}分`}</small></span>
        </button>
      </div>
    </section>`;

  activeSky = makeSky($('#sky'), {
    draw(ctx, w, h, time, glow) {
      const px = w / 2, py = Math.min(h * 0.16, 120);
      drawPolaris(ctx, px, py, time, glow);
      const size = Math.min(w * 0.82, h * 0.42);
      drawConstellation(ctx, { x: (w - size) / 2, y: py + 100, w: size, h: size * 0.85 }, c.index, c.lit, time, glow, { highlight: home.justLit });
    },
  });
  $$('[data-routine]').forEach(b => b.onclick = () => startRoutine(b.dataset.routine));
}
const home = { justLit: false };

// =========================================================
// 目標の編集
// =========================================================
function renderGoal() {
  view.innerHTML = `
    <section class="screen">
      <a href="#home" class="back">‹ ホーム</a>
      <h2>北極星（目標）</h2>
      <p class="sub">目指す方向を一文で。書き直しても、集めた星は消えません。</p>
      <textarea id="goal-text" rows="3" maxlength="60">${esc(state.goal?.text || '')}</textarea>
      <h3>テーマ</h3>
      <div class="theme-grid">
        ${Object.entries(THEMES).map(([k, t]) => `
          <label class="theme-chip"><input type="radio" name="theme" value="${k}" ${state.goal?.theme === k ? 'checked' : ''}>
            <span><i>${t.icon}</i>${t.name}</span></label>`).join('')}
      </div>
      <button class="primary-btn" id="save">保存する</button>
    </section>`;
  $('#save').onclick = () => {
    const text = $('#goal-text').value.trim();
    if (!text) { toast('目標を入力してください'); return; }
    state.goal = { ...(state.goal || {}), text, theme: $('input[name=theme]:checked')?.value || 'self', createdAt: state.goal?.createdAt || Date.now() };
    save();
    toast('北極星を更新しました');
    location.hash = '#home';
  };
}

// =========================================================
// ことば（アファメーション）
// =========================================================
function audioFor(a) {
  if (recordedIds.has(a.id)) return 'recording';
  if (a.source === 'template' && audioManifest.affirmations[a.id]) return 'voice';
  return 'text';
}
const AUDIO_BADGE = { recording: '<span class="badge rec">● 自分の声</span>', voice: '<span class="badge voice">♪ 音声あり</span>', text: '<span class="badge">文字のみ</span>' };

function renderWords() {
  const mine = state.affirmations;
  const used = new Set(mine.map(a => a.id));
  const activeCount = mine.filter(a => a.active).length;
  view.innerHTML = `
    <section class="screen">
      <h2>朝に唱えることば</h2>
      <p class="sub">オンのことばが朝のルーティンで流れます（${activeCount}個）。自分の声で録音すると、その声で再生されます。</p>
      <div class="word-list">
        ${mine.length ? mine.map(a => `
          <div class="word ${a.active ? '' : 'off'}" data-id="${esc(a.id)}">
            <label class="switch" title="朝に流す"><input type="checkbox" data-act="toggle" ${a.active ? 'checked' : ''}><span></span></label>
            <div class="word-body">
              <p>${esc(a.text)}</p>
              <div class="word-meta">${THEMES[a.theme] ? `<span class="theme-tag">${THEMES[a.theme].icon} ${THEMES[a.theme].name}</span>` : ''}${AUDIO_BADGE[audioFor(a)]}</div>
            </div>
            <div class="word-btns">
              <button class="icon-btn" data-act="play" aria-label="再生">▶</button>
              <button class="icon-btn" data-act="rec" aria-label="録音">🎙</button>
              <button class="icon-btn" data-act="del" aria-label="削除">✕</button>
            </div>
          </div>`).join('') : '<p class="empty">まだことばがありません。下から追加しましょう。</p>'}
      </div>

      <h3>自分のことばを書く</h3>
      <p class="hint">コツ：「私は〜しています」のように<b>現在形・肯定形</b>で、自分が心地よく感じる言い方に。</p>
      <div class="add-row">
        <input id="custom-text" maxlength="50" placeholder="例：私は、毎朝すがすがしく目覚めています。">
        <button class="secondary-btn" id="add-custom">追加</button>
      </div>

      <h3>文例集から追加</h3>
      ${Object.entries(THEMES).map(([k, t]) => `
        <details class="tmpl-group" ${state.goal?.theme === k ? 'open' : ''}>
          <summary>${t.icon} ${t.name}</summary>
          ${AFFIRMATION_TEMPLATES.filter(a => a.theme === k).map(a => `
            <div class="tmpl">
              <span>${esc(a.text)}</span>
              ${used.has(a.id) ? '<span class="added">追加済み</span>' : `<button class="mini-btn" data-add="${a.id}">＋ 追加</button>`}
            </div>`).join('')}
        </details>`).join('')}
    </section>`;

  $$('.word').forEach(row => {
    const a = state.affirmations.find(x => x.id === row.dataset.id);
    row.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'toggle') { a.active = e.target.checked; save(); row.classList.toggle('off', !a.active); }
      if (act === 'play') previewAffirmation(a);
      if (act === 'rec') openRecorder(a);
      if (act === 'del') {
        if (!confirm(`「${a.text}」を削除しますか？`)) return;
        state.affirmations = state.affirmations.filter(x => x !== a);
        await RecDB.del(a.id).catch(() => {});
        recordedIds.delete(a.id);
        save(); renderWords();
      }
    });
  });
  $('#add-custom').onclick = () => {
    const text = $('#custom-text').value.trim();
    if (!text) { $('#custom-text').focus(); return; }
    const a = { id: 'c' + Date.now().toString(36), text, theme: state.goal?.theme || 'self', source: 'custom', active: true };
    state.affirmations.push(a);
    save(); renderWords();
    toast('追加しました。🎙 から自分の声で録音できます');
  };
  $$('[data-add]').forEach(b => b.onclick = () => {
    const t = AFFIRMATION_TEMPLATES.find(x => x.id === b.dataset.add);
    state.affirmations.push({ ...t, source: 'template', active: true });
    save(); renderWords();
  });
}

let previewClip = null;
async function previewAffirmation(a) {
  if (previewClip) previewClip.stop();
  const src = await affirmationSrc(a);
  if (!src) { toast('音声がありません。🎙 で自分の声を録音できます'); return; }
  previewClip = Sound.playClip(src.url, state.settings.voiceVolume);
  previewClip.promise.then(() => src.revoke && src.revoke());
}

async function affirmationSrc(a) {
  if (recordedIds.has(a.id)) {
    const blob = await RecDB.get(a.id);
    if (blob) { const url = URL.createObjectURL(blob); return { url, revoke: () => URL.revokeObjectURL(url) }; }
  }
  const file = a.source === 'template' && audioManifest.affirmations[a.id];
  return file ? { url: file } : null;
}

// ---- 録音 ----
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  return m;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

async function openRecorder(a) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('このブラウザでは録音できません'); return; }
  const has = recordedIds.has(a.id);
  const m = openModal(`
    <h3>自分の声で録音</h3>
    <p class="rec-text">${esc(a.text)}</p>
    <p class="hint">ゆっくり、気持ちをこめて読んでみましょう（最大30秒）。</p>
    <div class="rec-ctrl">
      <button class="rec-btn" id="rec-btn" aria-label="録音開始"><span></span></button>
      <span id="rec-time">0:00</span>
    </div>
    <div class="modal-btns">
      <button class="secondary-btn" id="rec-play" ${has ? '' : 'disabled'}>▶ 聞く</button>
      ${has ? '<button class="secondary-btn" id="rec-del">録音を消す</button>' : ''}
      <button class="primary-btn" id="rec-close">閉じる</button>
    </div>`);
  let rec = null, stream = null, timer = null, started = 0;

  const stop = () => { if (rec && rec.state === 'recording') rec.stop(); };
  $('#rec-btn', m).onclick = async () => {
    if (rec && rec.state === 'recording') { stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('マイクを使えません。ブラウザの許可設定を確認してください'); return; }
    const chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      $('#rec-btn', m).classList.remove('on');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 2000) { toast('うまく録音できませんでした'); return; }
      await RecDB.put(a.id, blob);
      recordedIds.add(a.id);
      $('#rec-play', m).disabled = false;
      toast('録音を保存しました');
    };
    rec.start();
    started = Date.now();
    $('#rec-btn', m).classList.add('on');
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      $('#rec-time', m).textContent = `0:${String(s).padStart(2, '0')}`;
      if (s >= 30) stop();
    }, 250);
  };
  $('#rec-play', m).onclick = () => previewAffirmation(a);
  const del = $('#rec-del', m);
  if (del) del.onclick = async () => { await RecDB.del(a.id); recordedIds.delete(a.id); toast('録音を消しました'); closeModal(); renderWords(); };
  $('#rec-close', m).onclick = () => { stop(); closeModal(); if (location.hash === '#words') renderWords(); };
}

// =========================================================
// ルーティン
// =========================================================
// 各ステップは flow.sleep / flow.play で待つ。「次へ」で今のステップを飛ばし、✕で全体を中断する
class Flow {
  constructor() { this.cancelled = false; this.skipped = false; this.waiters = new Set(); }
  get stopped() { return this.cancelled || this.skipped; }
  _wait(start) {
    if (this.stopped) return Promise.resolve();
    return new Promise(res => {
      let w;
      const done = () => { if (!this.waiters.has(w)) return; this.waiters.delete(w); w.cleanup?.(); res(); };
      w = { done };
      this.waiters.add(w);
      start(w, done);
    });
  }
  sleep(ms) { return this._wait((w, done) => { const t = setTimeout(done, ms); w.cleanup = () => clearTimeout(t); }); }
  async play(url) {
    if (!url) return false;
    let ok = false;
    await this._wait((w, done) => {
      const clip = Sound.playClip(url, state.settings.voiceVolume);
      w.cleanup = () => clip.stop();
      clip.promise.then(r => { ok = r; done(); });
    });
    return ok;
  }
  waitFor(register) { return this._wait((w, done) => register(done)); }
  skip() { this.skipped = true; [...this.waiters].forEach(w => w.done()); }
  cancel() { this.cancelled = true; this.skip(); }
}

const R = {
  el: $('#routine'), stage: $('#routine-stage'), caption: $('#routine-caption'),
  title: $('#routine-title'), progress: $('#routine-progress'), skipBtn: $('#routine-skip'),
};
let flow = null, routineSky = null, wakeLock = null;

// ガイド：音声があれば再生、なければ文字だけを読める時間表示
async function guide(key, { minMs = 0 } = {}) {
  const text = GUIDE_SCRIPTS[key];
  R.caption.textContent = text;
  const url = audioManifest.guide[key];
  const t0 = Date.now();
  const played = url ? await flow.play(url) : false;
  if (!played) await flow.sleep(Math.max(2500, text.length * 140));
  const rest = minMs - (Date.now() - t0);
  if (rest > 0) await flow.sleep(rest);
}

function stage(html) { R.stage.innerHTML = html; }

const STEPS = {
  morning: [
    { name: '呼吸', run: stepBreath },
    { name: '目標', run: stepVisualize },
    { name: 'ことば', run: stepAffirm },
    { name: '完了', run: f => stepComplete(f, 'morning'), noSkip: true },
  ],
  night: [
    { name: '瞑想', run: stepMeditation },
    { name: 'ふり返り', run: stepReflect, noSkip: true },
    { name: '完了', run: f => stepComplete(f, 'night'), noSkip: true },
  ],
};

async function stepBreath() {
  stage('<div class="breath"><div class="breath-ring"></div><div class="breath-core" id="bcore"></div><p class="breath-word" id="bword"></p></div>');
  await guide('morning_intro');
  const core = $('#bcore'), word = $('#bword');
  const phases = [['breath_in', '吸って', 4000, 1.6], ['breath_hold', '止めて', 2000, 1.6], ['breath_out', '吐いて', 6000, 1]];
  const end = Date.now() + 60000;
  R.caption.textContent = '円の動きにあわせて、ゆっくり呼吸しましょう';
  while (!flow.stopped && Date.now() < end) {
    for (const [key, label, ms, scale] of phases) {
      if (flow.stopped) break;
      word.textContent = label;
      core.style.transition = `transform ${ms}ms ease-in-out`;
      core.style.transform = `scale(${scale})`;
      if (audioManifest.guide[key]) flow.play(audioManifest.guide[key]);
      await flow.sleep(ms);
    }
  }
}

async function stepVisualize() {
  stage(`<div class="visualize"><div class="mini-polaris">✦</div><p class="goal-big">${esc(state.goal?.text || '')}</p><div class="timer-bar"><span id="vbar"></span></div></div>`);
  await guide('visualize');
  const bar = $('#vbar');
  bar.style.transition = 'width 30s linear';
  requestAnimationFrame(() => { bar.style.width = '100%'; });
  R.caption.textContent = '目を閉じて、叶った場面を思い描きましょう';
  await flow.sleep(30000);
}

async function stepAffirm() {
  const list = state.affirmations.filter(a => a.active);
  if (!list.length) { stage('<p class="aff-text">ことばが選ばれていません</p>'); await flow.sleep(2000); return; }
  stage('<div class="aff"><p class="aff-text" id="atext"></p><p class="aff-count" id="acount"></p></div>');
  await guide('affirm_intro');
  // ここでの「次へ」は、ステップ全体ではなく次のことばへ進む
  for (let i = 0; i < list.length && !flow.cancelled; i++) {
    flow.skipped = false;
    const a = list[i];
    const t = $('#atext');
    t.classList.remove('in'); void t.offsetWidth;
    t.textContent = a.text; t.classList.add('in');
    $('#acount').textContent = `${i + 1} / ${list.length}`;
    const src = await affirmationSrc(a);
    if (src) {
      R.caption.textContent = '声に耳を傾けて、心の中で一緒に唱えましょう';
      const t0 = Date.now();
      await flow.play(src.url);
      src.revoke?.();
      await flow.sleep(Math.max(0, 4000 - (Date.now() - t0)));
    } else {
      R.caption.textContent = '心の中で、または声に出して唱えましょう';
      await flow.sleep(Math.max(7000, a.text.length * 330));
    }
    await flow.sleep(1800);
  }
}

async function stepMeditation() {
  const total = state.settings.meditationMinutes * 60;
  stage(`<div class="medi"><svg viewBox="0 0 120 120" class="medi-ring"><circle cx="60" cy="60" r="54" class="track"/><circle cx="60" cy="60" r="54" class="prog" id="mprog"/></svg><p class="medi-time" id="mtime"></p></div>`);
  const prog = $('#mprog'), tm = $('#mtime');
  const C = 2 * Math.PI * 54;
  prog.style.strokeDasharray = C;
  prog.style.strokeDashoffset = C;
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  tm.textContent = fmt(total);
  Sound.bell(0.5);
  await guide('night_intro');
  if (flow.cancelled) return;
  flow.skipped = false;   // 案内を飛ばしたら、瞑想タイマーから始める
  R.caption.textContent = '呼吸に意識を向けて、ただ、ここにいましょう';
  const end = Date.now() + total * 1000;
  while (!flow.stopped && Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / 1000);
    tm.textContent = fmt(left);
    prog.style.strokeDashoffset = C * (left / total);
    await flow.sleep(500);
  }
  if (flow.cancelled) return;
  flow.skipped = false;   // 飛ばしても終わりのベルと案内は流す
  prog.style.strokeDashoffset = 0;
  tm.textContent = '0:00';
  Sound.bell(0.6);
  await flow.sleep(2500);
  await guide('meditation_end');
}

async function stepReflect() {
  stage(`
    <form class="reflect" id="rform">
      <p class="reflect-q">今日の心の天気は？</p>
      <div class="moods">${MOODS.map(m => `<label><input type="radio" name="mood" value="${m.v}" ${m.v === 3 ? 'checked' : ''}><span><i>${m.icon}</i>${m.label}</span></label>`).join('')}</div>
      <textarea name="note" rows="3" maxlength="200" placeholder="よかったこと、気づいたこと、感謝したいこと…"></textarea>
      <button class="primary-btn" type="submit">記録して星を灯す</button>
    </form>`);
  R.caption.textContent = GUIDE_SCRIPTS.reflect_intro;
  if (audioManifest.guide.reflect_intro) flow.play(audioManifest.guide.reflect_intro);
  await flow.waitFor(done => {
    $('#rform').onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.journal.push({ date: dayKey(), mood: Number(fd.get('mood')), note: String(fd.get('note') || '').trim(), at: Date.now() });
      save();
      done();
    };
  });
}

async function stepComplete(f, type) {
  const added = addSession(type);
  const n = starCount();
  const c = constellationInfo(n);
  const justCompleted = added && c.lit === 0;
  const shownIndex = justCompleted ? c.index - 1 : c.index;
  const shownLit = justCompleted ? STARS_PER_CONSTELLATION : c.lit;
  stage(`
    <div class="complete">
      <canvas id="cstar"></canvas>
      <p class="complete-title">${added ? (justCompleted ? `${esc(constellationName(shownIndex))}が完成しました` : '星がひとつ灯りました') : '今日の星はすでに灯っています'}</p>
      <p class="complete-sub">${esc(constellationName(shownIndex))}　${shownLit} / ${STARS_PER_CONSTELLATION}　・　これまで ${n} 個の星</p>
      <button class="primary-btn" id="finish">ホームへ</button>
    </div>`);
  const sky = makeSky($('#cstar'), {
    density: 0,
    draw(ctx, w, h, time, glow) {
      const s = Math.min(w, h) * 0.9;
      drawConstellation(ctx, { x: (w - s) / 2, y: (h - s) / 2, w: s, h: s }, shownIndex, shownLit, time, glow, { highlight: added, scale: 1.3 });
    },
  });
  if (added) Sound.bell(0.35);
  // 締めの案内を流しつつ、「ホームへ」はいつでも押せるようにする
  const outro = guide(type === 'morning' ? 'morning_outro' : 'night_outro');
  await f.waitFor(done => { $('#finish').onclick = done; });
  f.skip();
  await outro;
  sky.stop();
}

async function startRoutine(type) {
  Sound.unlock();
  flow = new Flow();
  const steps = STEPS[type];
  R.title.textContent = type === 'morning' ? '☀ 朝のルーティン' : '☾ 夜のルーティン';
  R.el.className = type;
  R.el.hidden = false;
  document.body.classList.add('in-routine');
  routineSky = makeSky($('#routine-sky'), { density: 120 });
  const s = state.settings;
  const bgm = audioManifest.bgm.find(b => b.id === s.bgm);
  Sound.startBgm(bgm ? 'file' : s.bgm, s.bgmVolume, bgm?.file);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { wakeLock = null; }

  for (let i = 0; i < steps.length && !flow.cancelled; i++) {
    flow.skipped = false;
    R.progress.innerHTML = steps.map((st, j) => `<i class="${j < i ? 'past' : j === i ? 'now' : ''}">${st.name}</i>`).join('');
    R.skipBtn.hidden = !!steps[i].noSkip;
    R.caption.textContent = '';
    await steps[i].run(flow);
  }
  endRoutine();
}

function endRoutine() {
  Sound.stopBgm(2);
  if (routineSky) { routineSky.stop(); routineSky = null; }
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  R.el.hidden = true;
  R.stage.innerHTML = '';
  document.body.classList.remove('in-routine');
  const completed = flow && !flow.cancelled;
  flow = null;
  if (completed) home.justLit = true;
  location.hash === '#home' ? route() : (location.hash = '#home');
  setTimeout(() => { home.justLit = false; }, 6000);
}

R.skipBtn.onclick = () => flow?.skip();
$('#routine-close').onclick = () => {
  if (!flow) return;
  if (confirm('ルーティンを中断しますか？（星は灯りません）')) flow.cancel();
};

// =========================================================
// 記録
// =========================================================
let calMonth = null;
function renderRecords() {
  if (activeSky) { activeSky.stop(); activeSky = null; }
  const n = starCount();
  const c = constellationInfo(n);
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const days = new Date(y, mo + 1, 0).getDate();
  const offset = new Date(y, mo, 1).getDay();
  const key = d => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const byDate = {};
  state.sessions.forEach(s => { (byDate[s.date] ||= {})[s.type] = true; });
  const moodBy = {};
  state.journal.forEach(j => { moodBy[j.date] = j.mood; });
  const today = dayKey();
  const total = c.completed + 1;

  view.innerHTML = `
    <section class="screen">
      <h2>星の記録</h2>
      <div class="stats">
        <div><b>${n}</b><span>集めた星</span></div>
        <div><b>${c.completed}</b><span>完成した星座</span></div>
        <div><b>${new Set(state.sessions.map(s => s.date)).size}</b><span>取り組んだ日</span></div>
      </div>
      <p class="hint center">休んでも星は消えません。自分のペースで続けましょう。</p>

      <h3>星座</h3>
      <div class="const-grid">
        ${Array.from({ length: total }, (_, i) => `
          <figure class="const-card ${i === c.index ? 'current' : ''}">
            <canvas data-ci="${i}"></canvas>
            <figcaption>${esc(constellationName(i))}<small>${i < c.completed ? '完成' : `${c.lit} / ${STARS_PER_CONSTELLATION}`}</small></figcaption>
          </figure>`).reverse().join('')}
      </div>

      <h3>カレンダー</h3>
      <div class="cal">
        <div class="cal-head">
          <button class="icon-btn" id="cal-prev" aria-label="前の月">‹</button>
          <b>${y}年${mo + 1}月</b>
          <button class="icon-btn" id="cal-next" aria-label="次の月">›</button>
        </div>
        <div class="cal-grid">
          ${'日月火水木金土'.split('').map(d => `<span class="dow">${d}</span>`).join('')}
          ${'<span></span>'.repeat(offset)}
          ${Array.from({ length: days }, (_, i) => {
            const k = key(i + 1), b = byDate[k] || {};
            return `<span class="day ${k === today ? 'today' : ''}"><em>${i + 1}</em><i>${b.morning ? '<u class="m">☀</u>' : ''}${b.night ? '<u class="n">☾</u>' : ''}</i></span>`;
          }).join('')}
        </div>
      </div>

      <h3>ふり返り</h3>
      <div class="journal">
        ${state.journal.length ? [...state.journal].reverse().slice(0, 30).map(j => {
          const m = MOODS.find(x => x.v === j.mood) || MOODS[2];
          return `<div class="jentry"><span class="jmood" title="${m.label}">${m.icon}</span><div><small>${esc(j.date.replace(/-/g, '/'))}　${m.label}</small><p>${esc(j.note) || '<span class="muted">（メモなし）</span>'}</p></div></div>`;
        }).join('') : '<p class="empty">夜のルーティンで書いたふり返りがここに並びます。</p>'}
      </div>
    </section>`;

  $$('canvas[data-ci]').forEach(cv => {
    const i = Number(cv.dataset.ci);
    const lit = i < c.completed ? STARS_PER_CONSTELLATION : c.lit;
    const sky = makeSky(cv, {
      density: 30,
      draw(ctx, w, h, time, glow) {
        drawConstellation(ctx, { x: w * 0.08, y: h * 0.08, w: w * 0.84, h: h * 0.84 }, i, lit, time, glow, { scale: 0.7, lineWidth: 1 });
      },
    });
    const prevStop = activeSky;
    activeSky = { stop() { sky.stop(); prevStop?.stop(); } };
  });
  $('#cal-prev').onclick = () => { calMonth = new Date(y, mo - 1, 1); renderRecords(); };
  $('#cal-next').onclick = () => { calMonth = new Date(y, mo + 1, 1); renderRecords(); };
}

// =========================================================
// 設定
// =========================================================
function renderSettings() {
  const s = state.settings;
  const bgmOptions = [['space', '宇宙（やわらかな持続音）'], ['waves', '波の音'], ['rain', '雨の音'], ...audioManifest.bgm.map(b => [b.id, b.name]), ['none', 'なし']];
  const credits = [
    audioManifest.voice ? (audioManifest.engine === 'VOICEVOX' ? `音声：VOICEVOX:${esc(audioManifest.voice)}` : `音声：AivisSpeech「${esc(audioManifest.voice)}」`) : '',
    ...audioManifest.bgm.map(b => esc(b.credit || '')),
  ].filter(Boolean);
  view.innerHTML = `
    <section class="screen">
      <h2>設定</h2>
      <div class="card">
        <label class="field"><span>BGM</span>
          <select id="bgm">${bgmOptions.map(([v, l]) => `<option value="${v}" ${s.bgm === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <div class="field-row">
          <button class="secondary-btn" id="bgm-test">試聴</button>
        </div>
        <label class="field"><span>BGMの音量</span><input type="range" id="bgmVolume" min="0" max="1" step="0.05" value="${s.bgmVolume}"></label>
        <label class="field"><span>声の音量</span><input type="range" id="voiceVolume" min="0" max="1" step="0.05" value="${s.voiceVolume}"></label>
        <label class="field"><span>夜の瞑想の長さ</span>
          <select id="meditationMinutes">${[3, 5, 10, 15].map(m => `<option value="${m}" ${s.meditationMinutes === m ? 'selected' : ''}>${m}分</option>`).join('')}</select>
        </label>
      </div>

      <h3>データ</h3>
      <div class="card">
        <p class="hint">記録と録音はこの端末の中だけに保存されています。機種変更のときは書き出したファイルを新しい端末で読み込んでください。</p>
        <div class="field-row">
          <button class="secondary-btn" id="export">バックアップを書き出す</button>
          <button class="secondary-btn" id="import">読み込む</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
        <button class="danger-btn" id="reset">すべてのデータを消す</button>
      </div>

      <h3>このアプリについて</h3>
      <div class="card about">
        <p><b>Life Compass Coach</b>　MVP版</p>
        <p class="note">${esc(DISCLAIMER)}</p>
        ${credits.length ? `<p class="credits">${credits.join('<br>')}</p>` : ''}
      </div>
    </section>`;

  let testing = false;
  $('#bgm').onchange = e => { s.bgm = e.target.value; save(); if (testing) startTest(); };
  const startTest = () => {
    const b = audioManifest.bgm.find(x => x.id === s.bgm);
    Sound.startBgm(b ? 'file' : s.bgm, s.bgmVolume, b?.file);
  };
  $('#bgm-test').onclick = e => {
    testing = !testing;
    e.target.textContent = testing ? '停止' : '試聴';
    testing ? startTest() : Sound.stopBgm(1);
  };
  $('#bgmVolume').oninput = e => { s.bgmVolume = Number(e.target.value); Sound.setBgmVolume(s.bgmVolume); save(); };
  $('#voiceVolume').onchange = e => { s.voiceVolume = Number(e.target.value); save(); };
  $('#meditationMinutes').onchange = e => { s.meditationMinutes = Number(e.target.value); save(); };
  window.addEventListener('hashchange', () => { if (testing) Sound.stopBgm(1); }, { once: true });

  $('#export').onclick = exportBackup;
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  $('#reset').onclick = async () => {
    if (!confirm('目標・ことば・星・ふり返り・録音をすべて消します。元に戻せません。よろしいですか？')) return;
    state = defaultState(); save();
    await RecDB.clear().catch(() => {});
    recordedIds.clear();
    location.hash = '#welcome';
  };
}

const blobToDataURL = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

async function exportBackup() {
  const recordings = {};
  for (const id of await RecDB.keys()) {
    const b = await RecDB.get(id);
    if (b) recordings[id] = await blobToDataURL(b);
  }
  const data = { app: 'LifeCompassCoach', version: 1, exportedAt: new Date().toISOString(), state, recordings };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `life-compass-backup-${dayKey().replace(/-/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('バックアップを書き出しました');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'LifeCompassCoach' || !data.state) throw new Error('format');
    if (!confirm('今のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
    const d = defaultState();
    state = { ...d, ...data.state, settings: { ...d.settings, ...(data.state.settings || {}) } };
    save();
    await RecDB.clear().catch(() => {});
    for (const [id, url] of Object.entries(data.recordings || {})) {
      await RecDB.put(id, await (await fetch(url)).blob());
    }
    await refreshRecorded();
    toast('読み込みました');
    location.hash = '#home';
  } catch (e) {
    toast('読み込めませんでした。バックアップファイルか確認してください');
  }
}

// =========================================================
// 起動
// =========================================================
(async function init() {
  await Promise.all([loadAudioManifest(), refreshRecorded().catch(() => {})]);
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
