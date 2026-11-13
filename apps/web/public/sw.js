// KONTIVA ERP · service worker mínimo: permite instalar la app y abrirla sin conexión
// con un aviso. Nunca guarda respuestas de la API (datos de la empresa).
const CACHE = 'kontiva-v1';
const BASICOS = ['/icono-192.png', '/icono-512.png', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // Páginas: siempre de la red; sin conexión, la última versión de la app.
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put('/', copia));
          return r;
        })
        .catch(() => caches.match('/').then((r) => r || new Response('Sin conexión. Vuelva a intentar cuando tenga internet.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Archivos con hash: primero la caché.
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return res;
    })));
  }
});
