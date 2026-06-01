// Minimal network-first service worker — makes GymApp installable without
// causing stale-content problems (always tries the network first).
const CACHE = 'gymapp-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POST/PATCH/DELETE
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // never cache API calls (Groq/OpenRouter/Supabase)

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))                     // offline fallback
  );
});
