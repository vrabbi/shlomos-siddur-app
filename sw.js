/* offline cache for סידור הילולת רבי שלמה – bump VERSION on every content/app change */
const VERSION = 'siddur-v5';
const FILES = [
  './', 'index.html', 'app.css', 'app.js', 'content.json', 'manifest.webmanifest',
  'fonts/FrankRuehlCLM-Medium.woff2', 'fonts/FrankRuehlCLM-Bold.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];
self.addEventListener('install', e => {
  // cache:'reload' bypasses the browser HTTP cache (GitHub Pages sends max-age=600), otherwise a fresh VERSION can be filled with stale files
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // YouTube etc. go straight to the network
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
