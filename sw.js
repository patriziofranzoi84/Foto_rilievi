/* Service worker - cache dell'app per apertura rapida e uso offline.
   Strategia: RETE PRIMA. Ad ogni apertura con connessione scarica la versione piu' recente dei file
   (e aggiorna la cache); se la rete manca o e' troppo lenta (4 s) usa la copia in cache. */
const CACHE = 'foto-rilievi-v3';
const ASSETS = ['./', 'index.html', 'style.css', 'editor.js', 'pdf.js', 'app.js', 'manifest.json', 'icon.svg', 'version.json'];
const TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (new URL(req.url).searchParams.has('_')) return;     // controllo versione: sempre diretto in rete, mai in cache
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      net,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))
    ]);
  } catch (err) {
    net.catch(() => {});
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    return net;
  }
}
