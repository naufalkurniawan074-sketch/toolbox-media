const express = require('express');
const dns = require('node:dns').promises;
const net = require('node:net');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const MAX_BYTES = Math.max(1, Number(process.env.MAX_DOWNLOAD_MB || 100)) * 1024 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://naufalkurniawan074-sketch.github.io')
  .split(',').map(value => value.trim()).filter(Boolean);
const ALLOWED_MEDIA_HOSTS = (process.env.ALLOWED_MEDIA_HOSTS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const requestsByIp = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));

function jsonError(res, status, code, message) {
  return res.status(status).json({ ok: false, error: code, message });
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return jsonError(res, 403, 'origin_not_allowed', 'Origin ini tidak diizinkan oleh konfigurasi backend.');
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const current = requestsByIp.get(ip);
  if (!current || now - current.start >= RATE_LIMIT_WINDOW_MS) {
    requestsByIp.set(ip, { start: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', '60');
    return jsonError(res, 429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sekitar satu menit.');
  }
  next();
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 0);
}

function isPrivateIPv6(address) {
  const ip = address.toLowerCase().split('%')[0];
  return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
    ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') ||
    ip.startsWith('feb') || ip.startsWith('ff') || ip.startsWith('::ffff:');
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    throw Object.assign(new Error('IP address is not accepted; use an approved public media hostname.'), { status: 400, code: 'ip_not_allowed' });
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw Object.assign(new Error('Host video tidak bisa ditemukan.'), { status: 400, code: 'host_lookup_failed' });
  }
  if (!records.length || records.some(record => {
    const version = net.isIP(record.address);
    return version === 4 ? isPrivateIPv4(record.address) : version === 6 ? isPrivateIPv6(record.address) : true;
  })) {
    throw Object.assign(new Error('Host tidak lolos pemeriksaan alamat publik.'), { status: 400, code: 'host_not_public' });
  }
}

function safeFilename(url, contentType) {
  const leaf = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90);
  const extFromType = contentType.includes('webm') ? '.webm' :
    contentType.includes('quicktime') ? '.mov' :
    contentType.includes('ogg') ? '.ogv' : '.mp4';
  const candidate = leaf && /\.(mp4|webm|mov|m4v|ogv)$/i.test(leaf) ? leaf : 'authorized-video' + extFromType;
  return candidate.replace(/[\r\n"]/g, '_');
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'toolbox-media-backend',
    mode: 'authorized-direct-media-only',
    configuredMediaHosts: ALLOWED_MEDIA_HOSTS.length
  });
});

app.post('/api/download-direct', rateLimit, async (req, res) => {
  if (!ALLOWED_MEDIA_HOSTS.length) {
    return jsonError(res, 503, 'media_hosts_not_configured',
      'Backend belum dikonfigurasi. Tambahkan ALLOWED_MEDIA_HOSTS dengan hostname media milikmu atau sumber file yang memang mengizinkan unduhan.');
  }
  const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!raw || raw.length > 2048) {
    return jsonError(res, 400, 'invalid_url', 'Berikan URL file video langsung yang valid.');
  }

  let url;
  try { url = new URL(raw); } catch (error) {
    return jsonError(res, 400, 'invalid_url', 'URL tidak valid.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const isTikTokHost = host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
    host === 'tiktokcdn.com' || host.endsWith('.tiktokcdn.com');
  if (isTikTokHost) {
    return jsonError(res, 400, 'tiktok_page_not_supported',
      'Endpoint ini tidak mengambil video dari halaman TikTok. Gunakan Bagikan → Simpan video bila kreator mengizinkannya, atau pakai URL file langsung dari sumber yang kamu punya izin untuk unduh.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    return jsonError(res, 400, 'https_required', 'URL harus HTTPS tanpa kredensial dan tanpa port khusus.');
  }
  if (!ALLOWED_MEDIA_HOSTS.includes(host)) {
    return jsonError(res, 403, 'host_not_allowlisted', 'Hostname sumber belum ada di ALLOWED_MEDIA_HOSTS pada konfigurasi server.');
  }

  try {
    await assertPublicHost(host);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let upstream;
    try {
      upstream = await fetch(url.href, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'User-Agent': 'ToolboxMedia/1.0 (authorized direct-media proxy)' }
      });
    } catch (error) {
      clearTimeout(timeout);
      return jsonError(res, 502, 'source_fetch_failed', 'Sumber file tidak dapat diakses secara langsung atau melakukan redirect.');
    }

    if (!upstream.ok) {
      clearTimeout(timeout);
      return jsonError(res, 502, 'source_http_error', 'Sumber file merespons HTTP ' + upstream.status + '.');
    }
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const leaf = url.pathname.split('/').pop() || '';
    const extensionLooksVideo = /\.(mp4|webm|mov|m4v|ogv)$/i.test(leaf);
    if (!contentType.startsWith('video/') && !(contentType === 'application/octet-stream' && extensionLooksVideo)) {
      clearTimeout(timeout);
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      return jsonError(res, 415, 'not_a_video', 'URL sumber tidak mengembalikan file video yang dikenali.');
    }

    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > MAX_BYTES) {
      clearTimeout(timeout);
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      return jsonError(res, 413, 'file_too_large', 'Ukuran file melewati batas ' + Math.round(MAX_BYTES / 1024 / 1024) + ' MB.');
    }
    if (!upstream.body) {
      clearTimeout(timeout);
      return jsonError(res, 502, 'empty_body', 'Sumber tidak mengirim isi file.');
    }

    const filename = safeFilename(url, contentType);
    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Cache-Control', 'no-store');
    if (length > 0) res.setHeader('Content-Length', String(length));

    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return callback(Object.assign(new Error('File melewati batas ukuran.'), { code: 'LIMIT_EXCEEDED' }));
        callback(null, chunk);
      }
    });
    try {
      await pipeline(Readable.fromWeb(upstream.body), limiter, res);
    } catch (error) {
      if (!res.headersSent) jsonError(res, error.code === 'LIMIT_EXCEEDED' ? 413 : 502, 'stream_failed', 'Pengiriman video gagal atau file terlalu besar.');
      else res.destroy(error);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return jsonError(res, error.status || 500, error.code || 'server_error', error.message || 'Permintaan gagal.');
  }
});

app.get('/', (req, res) => {
  res.type('text').send('Toolbox Media backend aktif. Cek /health untuk status.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Toolbox Media backend listening on port ' + PORT);
});
