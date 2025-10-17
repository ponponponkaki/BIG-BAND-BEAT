// sw.js — 完全版（音声の Range 対応 / HTML は network-first / その他は cache-first）
const VERSION = 'v1';
const PRECACHE = `tds-lottery-precache-${VERSION}`;
const RUNTIME  = `tds-lottery-runtime-${VERSION}`;

// 事前キャッシュする静的アセット（必要に応じて増減OK）
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  // 画像
  './background-1.jpg',
  './background-2.jpg',
  './background-3.jpg',
  './lottery machine.png',
  './compass-button.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // 音声（必ず含める）
  './当たり音.mp3',
  './外れ音.mp3',
  './抽選音.mp3',
  './読み込み音.mp3',
  // jsQR をローカル同梱している場合は有効化
  // './lib/jsQR.min.js',
];

/* ---------- install / activate ---------- */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PRECACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== PRECACHE && k !== RUNTIME) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

/* ---------- Range(部分取得)対応：音声がオフラインでも確実に再生されるように ---------- */
async function respondWithRangeFromCache(request, cached) {
  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) return cached;

  const blob = await cached.clone().blob();
  const size = blob.size;

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  const start = m && m[1] ? parseInt(m[1], 10) : 0;
  const endInc = m && m[2] ? parseInt(m[2], 10) : size - 1;
  const end = Math.min(endInc, size - 1);

  const chunk = blob.slice(start, end + 1);
  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみSWで処理（外部CDNなどは素通し）
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const precache = await caches.open(PRECACHE);
    const runtime  = await caches.open(RUNTIME);

    // 1) HTML は network-first（更新を拾いやすく）、失敗時は cache fallback
    if (req.destination === 'document' || (req.mode === 'navigate')) {
      try {
        const net = await fetch(req);
        runtime.put(req, net.clone());
        return net;
      } catch {
        // ランタイム → プレキャッシュ → それでもだめなら簡易レスポンス
        return (await runtime.match(req, { ignoreSearch: true }))
            || (await precache.match(req, { ignoreSearch: true }))
            || (await precache.match('./index.html'));
      }
    }

    // 2) 音声・画像・CSS・JSなどは cache-first（ignoreSearch でクエリ差分も吸収）
    const cached =
      (await precache.match(req, { ignoreSearch: true })) ||
      (await runtime.match(req,  { ignoreSearch: true }));

    if (cached) {
      // 音声/動画の Range リクエスト
      if (req.headers.get('Range') && (req.destination === 'audio' || req.destination === 'video')) {
        return respondWithRangeFromCache(req, cached);
      }
      return cached;
    }

    // 3) キャッシュに無ければ取得して runtime に保存（初回オンライン時）
    try {
      const res = await fetch(req);
      if (req.method === 'GET' && res.ok) {
        runtime.put(req, res.clone());
      }
      return res;
    } catch {
      // 4) 最後の砦：index.html を返す（SPA のオフライン航続性確保）
      const fallback = await precache.match('./index.html');
      return fallback || new Response('', { status: 503 });
    }
  })());
});
