const CACHE_NAME = 'ripstick-v24';
// Must match SHARE_CACHE in src/share-target.ts
const SHARE_CACHE = 'ripstick-share-temp';

self.addEventListener('install', (event) => {
  // Skip waiting to activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first for API calls
  if (event.request.url.includes('api.github.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  const url = new URL(event.request.url);

  // Share target — POST with multipart form data (images + text)
  if (url.pathname.endsWith('/share') && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();

        // Extract the shared image file (if any) and store in temp cache
        const imageFile = formData.get('image');
        if (imageFile && imageFile instanceof File && imageFile.size > 0) {
          const cache = await caches.open(SHARE_CACHE);
          // Store the raw file as a Response so the app can read it
          const response = new Response(imageFile, {
            headers: { 'Content-Type': imageFile.type },
          });
          await cache.put('/ripstick-mobile/shared-image', response);
        }

        // Forward text params as query string so the app can read them
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const shareUrl = formData.get('url') || '';
        const params = new URLSearchParams();
        if (title) params.set('title', title);
        if (text) params.set('text', text);
        if (shareUrl) params.set('url', shareUrl);
        // Flag that an image is available in the share cache
        if (imageFile && imageFile instanceof File && imageFile.size > 0) {
          params.set('has_image', '1');
        }

        const redirectUrl = `/ripstick-mobile/?${params.toString()}`;
        return Response.redirect(redirectUrl, 303);
      })()
    );
    return;
  }

  // Share target navigation (GET fallback for text-only shares from older behavior)
  if (url.pathname.endsWith('/share') && event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/ripstick-mobile/').then((cached) =>
        cached || fetch('/ripstick-mobile/')
      )
    );
    return;
  }

  // Cache-first for app shell, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || fetched;
    })
  );
});
