// The Bakery Side — service worker de los paneles (cocina, moto, master): avisos en el celular
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // necesario para poder instalar como app; no guarda nada en caché

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "The Bakery Side", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    tag: d.tag,
    renotify: Boolean(d.tag),
    vibrate: [200, 100, 200],
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname === url.pathname && "focus" in w) return w.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});
