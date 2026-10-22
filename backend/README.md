# Toolbox Media backend

Backend ini dipakai untuk mengunduh **file video langsung yang kamu miliki atau punya izin untuk simpan** dari host HTTPS yang sudah diizinkan. Backend ini **bukan pengunduh universal halaman TikTok** dan sengaja menolak link halaman/CDN TikTok agar tidak melewati pengaturan unduhan kreator.

## Deploy ke Render

1. Buka https://render.com dan masuk/daftar.
2. Pilih **New → Web Service**.
3. Hubungkan repository `naufalkurniawan074-sketch/toolbox-media`.
4. Set **Root Directory** ke `backend`.
5. Build command: `npm install`.
6. Start command: `npm start`.
7. Pilih Free untuk percobaan jika tersedia, lalu buat service.

Render menyediakan URL HTTPS `https://nama-service.onrender.com` sesudah deploy. Pada Render, buka **Environment** dan tambahkan:

- `ALLOWED_ORIGINS=https://naufalkurniawan074-sketch.github.io`
- `ALLOWED_MEDIA_HOSTS=media-domain-milikmu.example` (ganti dengan hostname file media langsung yang kamu miliki/diizinkan, tanpa protokol atau path)
- `MAX_DOWNLOAD_MB=100`

Simpan perubahan dan tunggu redeploy. Endpoint kesehatan: `https://nama-service.onrender.com/health`. Endpoint unduh: `https://nama-service.onrender.com/api/download-direct`.

## API

`POST /api/download-direct`

Header: `Content-Type: application/json`

Body:
```json
{"url":"https://media-domain-milikmu.example/path/video.mp4"}
```

Server hanya menerima HTTPS, hostname persis yang ada di `ALLOWED_MEDIA_HOSTS`, file video, ukuran maksimal sesuai `MAX_DOWNLOAD_MB`, dan menolak redirect serta alamat privat. CORS hanya mengizinkan origin di `ALLOWED_ORIGINS`.

**Penting:** menaruh kode di GitHub tidak otomatis menerbitkan backend. Backend berjalan setelah dibuat sebagai Web Service di Render. URL halaman TikTok biasa bukan URL file video langsung dan akan ditolak. Untuk TikTok, gunakan fitur resmi **Bagikan → Simpan video** bila kreator mengizinkan; jangan menganggap endpoint ini bisa melewati pembatasan tersebut.
