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

// ── Web push reminders ──
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: 'Set', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Set 🎙️', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) { if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
