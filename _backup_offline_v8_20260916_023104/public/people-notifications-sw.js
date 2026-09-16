"use strict";

const PEOPLE_NOTIFICATIONS_SW_VERSION = "20260908-4";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
