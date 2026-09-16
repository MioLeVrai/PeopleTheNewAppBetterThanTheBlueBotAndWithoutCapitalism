"use strict";

const PEOPLE_NOTIFICATIONS_SW_VERSION = "20260916-offline-1";
const PEOPLE_SHELL_CACHE = "people-shell-20260916-offline-1";
const PEOPLE_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/socket.io/socket.io.js",
  "/style.css",
  "/people-offline.css",
  "/people-offline.js",
  "/people-avatars.js",
  "/people-rich-content.js",
  "/people-message-actions.js",
  "/people-camera-effects.js",
  "/app.js",
  "/people-avatar-cropper.js",
  "/people-avatar-ultra.js",
  "/people-settings.js",
  "/people-social.js",
  "/people-message-reactions.js",
  "/people-servers.js",
  "/people-server-channels.js",
  "/people-server-settings.js",
  "/people-local-controls.js",
  "/people-page-title.js",
  "/people-mobile.js",
  "/people-dm-calls.js",
  "/people-media-fullscreen.js",
  "/people-image-viewer.js",
  "/people-server-voice-ui.js",
  "/people-appearance-settings-v2.js",
  "/people-theme-studio.js",
  "/people-unread.js",
  "/people-appearance.css",
  "/people-settings.css",
  "/people-server-channels.css",
  "/people-server-settings.css",
  "/people-dm-calls.css",
  "/people-mobile.css",
  "/people-media-fullscreen.css",
  "/people-image-viewer.css",
  "/people-server-voice-ui.css",
  "/people-appearance-settings-v2.css",
  "/people-theme-studio.css",
  "/people-unread.css",
  "/people-composer-lower.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PEOPLE_SHELL_CACHE);
      await Promise.allSettled(
        PEOPLE_SHELL_ASSETS.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) await cache.put(url, response.clone());
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("people-shell-") && key !== PEOPLE_SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/socket.io/") && url.pathname !== "/socket.io/socket.io.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(PEOPLE_SHELL_CACHE);
            await cache.put("/", fresh.clone());
          }
          return fresh;
        } catch {
          return (await caches.match(request)) || (await caches.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  const isStatic = /\.(?:js|css|png|jpg|jpeg|webp|gif|ico|svg|woff2?)$/i.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      const refresh = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(PEOPLE_SHELL_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }

      return (await refresh) || Response.error();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PEOPLE_SHOW_NOTIFICATION") return;

  const replyPort = event.ports?.[0] || null;

  event.waitUntil(
    (async () => {
      try {
        const title = String(event.data?.title || "People");
        const options = event.data?.options || {};

        await self.registration.showNotification(title, options);

        let count = null;
        try {
          const current = await self.registration.getNotifications(
            options?.tag ? { tag: options.tag } : undefined
          );
          count = current.length;
        } catch {}

        replyPort?.postMessage({
          ok: true,
          count,
          version: PEOPLE_NOTIFICATIONS_SW_VERSION
        });
      } catch (error) {
        replyPort?.postMessage({
          ok: false,
          error: error?.message || String(error),
          version: PEOPLE_NOTIFICATIONS_SW_VERSION
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          try {
            const clientUrl = new URL(client.url);
            const target = new URL(targetUrl, self.location.origin);

            if (clientUrl.origin === target.origin && "focus" in client) {
              await client.focus();

              if ("navigate" in client && client.url !== target.href) {
                try {
                  await client.navigate(target.href);
                } catch {}
              }
              return;
            }
          } catch {}
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
