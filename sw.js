// オフライン対応：アプリ本体は先に保存、音声やフォントは使ったときに保存する
const VERSION = 'lcc-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'data.js', 'audio.js', 'app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const put = r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; };
  // 音声・画像・フォントは変わらないので保存済みを優先
  if (/\.(mp3|ogg|wav|m4a|png|svg|woff2?)$/.test(url.pathname) || url.hostname.includes('fonts.')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(put)));
    return;
  }
  // アプリ本体は最新を優先し、オフライン時だけ保存済みを使う
  e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
