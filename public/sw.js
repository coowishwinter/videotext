const APP_CACHE_NAME = 'shengji-app-shell-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/ort/ort-wasm-simd-threaded.asyncify.mjs',
        '/ort/ort-wasm-simd-threaded.asyncify.wasm',
        '/ort/ort-wasm-simd-threaded.mjs',
        '/ort/ort-wasm-simd-threaded.wasm',
      ]).catch(() => {
        // Ignore partial precache misses in dev
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('shengji-app-shell-') && key !== APP_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept cross-origin requests (Hugging Face models are cached by Transformers.js in transformers-cache)
  if (url.origin !== self.location.origin) return;
  // Never intercept Vite dev/HMR endpoints
  if (url.pathname.startsWith('/@') || url.pathname.includes('?t=')) return;

  // Cache-first for local ONNX Runtime WASM assets and bundled static assets
  if (url.pathname.startsWith('/ort/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first with offline fallback for navigation and root shell
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
  }
});
