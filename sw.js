/* Service Worker — อ่านคอร์ด Tablet
   เปลี่ยนเลข VERSION ทุกครั้งที่อัปโหลดไฟล์ใหม่ เพื่อให้เครื่องล้างแคชเก่า */
const VERSION = 'v2';
const CACHE = 'chord-reader-' + VERSION;

// ไฟล์ของแอป (ต้องโหลดได้ครบ ไม่งั้นติดตั้ง SW ไม่สำเร็จ)
const CORE = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// ไฟล์ภายนอกที่หน้าเว็บต้องใช้ (พลาดได้ ไม่ทำให้ติดตั้งล้ม)
const EXTERNAL = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Sarabun:wght@400;500;600;700&display=swap'
];

// โฮสต์ภายนอกที่อนุญาตให้แคช (ไม่แคช Cloudflare Worker ที่ซิงค์เพลง เพื่อไม่ให้ได้ข้อมูลเก่า)
const CACHEABLE_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // หน้าแอป: เก็บสำเนา "สะอาด" (ไม่ติดสถานะ redirect) ไว้ทั้งสองชื่อ
    const pageRes = await fetch(new Request('./', { cache: 'reload' }));
    if (!pageRes.ok) throw new Error('โหลดหน้าแอปไม่สำเร็จ');
    const pageClean = await cleanResponse(pageRes);
    await cache.put('./', pageClean.clone());
    await cache.put('./index.html', pageClean.clone());
    for (const path of CORE) {
      const res = await fetch(new Request(path, { cache: 'reload' }));
      if (!res.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ: ' + path);
      await cache.put(path, await cleanResponse(res));
    }
    await Promise.all(EXTERNAL.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        await cache.put(url, res);
      } catch (e) { /* ออฟไลน์ตอนติดตั้ง: จะแคชทีหลังตอนเปิดใช้งานออนไลน์ */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chord-reader-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Safari/Chrome ไม่ยอมให้ตอบหน้าเว็บด้วยผลลัพธ์ที่ผ่านการ redirect (เช่น /index.html -> /)
// จึงสร้างสำเนาใหม่ที่ไม่มีสถานะ redirect ก่อนเก็บลงแคช
async function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

// หน้าเว็บ: ลองเน็ตก่อน (ได้เวอร์ชันใหม่) ถ้าช้า/ออฟไลน์ใช้ของที่แคชไว้
async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(request, 3500);
    const path = new URL(request.url).pathname;
    if (res && res.ok && (path.endsWith('/') || path.endsWith('/index.html'))) {
      const clean = await cleanResponse(res.clone());
      await cache.put('./', clean.clone());
      await cache.put('./index.html', clean.clone());
    }
    return res;
  } catch (e) {
    return (await cache.match('./')) || (await cache.match('./index.html')) || Response.error();
  }
}

// ไฟล์อื่น ๆ: ใช้ของในแคชทันที แล้วอัปเดตเบื้องหลัง
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(req));
    return;
  }
  if (url.origin === self.location.origin || CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
  // อย่างอื่น (เช่น Cloudflare Worker ซิงค์เพลง) ปล่อยผ่านไปตามปกติ
});
