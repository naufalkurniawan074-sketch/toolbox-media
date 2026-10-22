const DEFAULT_ORIGIN = "https://naufalkurniawan074-sketch.github.io";
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function getConfig(env) {
  const origins = (env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(",").map(x => x.trim()).filter(Boolean);
  const hosts = (env.ALLOWED_MEDIA_HOSTS || "").split(",")
    .map(x => x.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  const maxMb = Number(env.MAX_DOWNLOAD_MB || 100);
  return { origins, hosts, maxBytes: Math.max(1, Number.isFinite(maxMb) ? maxMb : 100) * 1024 * 1024 };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

function isTikTokHost(host) {
  return host === "tiktok.com" || host.endsWith(".tiktok.com") ||
    host === "tiktokcdn.com" || host.endsWith(".tiktokcdn.com");
}

function safeFilename(url, contentType) {
  let leaf = url.pathname.split("/").pop() || "";
  try { leaf = decodeURIComponent(leaf); } catch (_) {}
  leaf = leaf.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
  const ext = contentType.includes("webm") ? ".webm" :
    contentType.includes("quicktime") ? ".mov" :
    contentType.includes("ogg") ? ".ogv" : ".mp4";
  return (leaf && VIDEO_EXT.test(leaf) ? leaf : "authorized-video" + ext).replace(/[\r\n"]/g, "_");
}

export default {
  async fetch(request, env) {
    const { origins, hosts, maxBytes } = getConfig(env);
    const origin = request.headers.get("Origin");
    if (origin && !origins.includes(origin)) {
      return json({ ok: false, error: "origin_not_allowed", message: "Origin situs tidak diizinkan." }, 403);
    }
    const cors = origin ? corsHeaders(origin) : { "X-Content-Type-Options": "nosniff" };
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "toolbox-media-backend", mode: "authorized-direct-media-only" }, 200, cors);
    }
    if (url.pathname !== "/api/download-direct") {
      return json({ ok: false, error: "not_found", message: "Endpoint tidak ditemukan." }, 404, cors);
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed", message: "Gunakan POST." }, 405, { ...cors, Allow: "POST, OPTIONS" });
    }
    if (!hosts.length) {
      return json({ ok: false, error: "media_hosts_not_configured", message: "Tambahkan ALLOWED_MEDIA_HOSTS di pengaturan Worker terlebih dahulu." }, 503, cors);
    }

    let body;
    try { body = await request.json(); } catch (_) {
      return json({ ok: false, error: "invalid_json", message: "Body harus berupa JSON." }, 400, cors);
    }
    if (!body || typeof body.url !== "string" || body.url.length > 2048) {
      return json({ ok: false, error: "invalid_url", message: "Isi URL file video langsung yang valid." }, 400, cors);
    }

    let mediaUrl;
    try { mediaUrl = new URL(body.url); } catch (_) {
      return json({ ok: false, error: "invalid_url", message: "URL tidak valid." }, 400, cors);
    }
    const host = mediaUrl.hostname.toLowerCase().replace(/\.$/, "");
    if (isTikTokHost(host)) {
      return json({
        ok: false,
        error: "tiktok_page_not_supported",
        message: "Endpoint ini tidak mengambil video dari halaman atau CDN TikTok. Jika kreator mengizinkan unduhan, gunakan fitur Bagikan → Simpan video di TikTok."
      }, 400, cors);
    }
    if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password ||
        (mediaUrl.port && mediaUrl.port !== "443")) {
      return json({ ok: false, error: "https_required", message: "URL harus HTTPS tanpa kredensial atau port khusus." }, 400, cors);
    }
    if (!hosts.includes(host)) {
      return json({ ok: false, error: "host_not_allowlisted", message: "Hostname sumber belum ada di ALLOWED_MEDIA_HOSTS." }, 403, cors);
    }

    let upstream;
    try {
      upstream = await fetch(mediaUrl.href, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "ToolboxMedia/1.0 (authorized direct-media proxy)" }
      });
    } catch (_) {
      return json({ ok: false, error: "source_fetch_failed", message: "Sumber file tidak dapat diakses." }, 502, cors);
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return json({ ok: false, error: "redirect_not_allowed", message: "Sumber mengarahkan ke URL lain; redirect tidak diikuti demi keamanan." }, 502, cors);
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return json({ ok: false, error: "source_http_error", message: "Sumber file merespons HTTP " + upstream.status + "." }, 502, cors);
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("video/") &&
        !(contentType === "application/octet-stream" && VIDEO_EXT.test(mediaUrl.pathname))) {
      await upstream.body?.cancel();
      return json({ ok: false, error: "not_a_video", message: "URL sumber tidak mengembalikan file video yang dikenali." }, 415, cors);
    }
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      await upstream.body?.cancel();
      return json({ ok: false, error: "file_too_large", message: "Ukuran file melampaui batas " + Math.round(maxBytes / 1024 / 1024) + " MB." }, 413, cors);
    }
    if (!upstream.body) {
      return json({ ok: false, error: "empty_body", message: "Sumber tidak mengirim isi file." }, 502, cors);
    }

    let sent = 0;
    const limiter = new TransformStream({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        if (sent > maxBytes) throw new Error("MAX_FILE_SIZE");
        controller.enqueue(chunk);
      }
    });
    const headers = new Headers({
      ...cors,
      "Content-Type": contentType,
      "Content-Disposition": 'attachment; filename="' + safeFilename(mediaUrl, contentType) + '"',
      "Cache-Control": "no-store"
    });
    if (contentLength > 0) headers.set("Content-Length", String(contentLength));

    const limitedBody = upstream.body.pipeThrough(limiter);
    return new Response(limitedBody, { status: 200, headers });
  }
};
