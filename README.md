# Toolbox Media

Situs statis Toolbox Media: https://naufalkurniawan074-sketch.github.io/toolbox-media/

## Backend gratis dengan Cloudflare Workers

Backend Worker disediakan di folder `backend/`. Cloudflare Workers punya paket Free yang mencakup kuota permintaan harian; batas resmi dan detailnya ada di [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

### Cara menerbitkan melalui browser

1. Masuk atau buat akun Cloudflare di https://dash.cloudflare.com/
2. Buka **Workers & Pages** → **Create application** → **Connect to Git** / GitHub.
3. Pilih repository `naufalkurniawan074-sketch/toolbox-media` dan hubungkan akun GitHub jika diminta.
4. Atur root/build directory ke `backend` jika diminta.
5. Gunakan build command `npm install` dan deploy command `npx wrangler deploy`.
6. Pastikan konfigurasi Worker membaca `backend/wrangler.toml`, dengan nama Worker `toolbox-media-backend`.
7. Klik **Save and Deploy**. Setelah selesai, Cloudflare akan menampilkan URL HTTPS seperti `https://toolbox-media-backend.<akun>.workers.dev`.
8. Buka pengaturan Worker → **Settings → Variables and Secrets** dan tambah variable `ALLOWED_MEDIA_HOSTS` berisi hostname file-video langsung yang kamu miliki atau diizinkan untuk diunduh. Tulis hostname saja, tanpa `https://`, tanpa path, dan pisahkan beberapa hostname dengan koma.
9. Tes `https://NAMA-WORKER.workers.dev/health`; jika hasilnya JSON dengan `"ok":true`, backend sudah aktif.
10. Pada tool di situs Toolbox, isi endpoint dengan `https://NAMA-WORKER.workers.dev/api/download-direct`. Untuk kolom URL media, gunakan URL HTTPS langsung ke file MP4/WebM dari hostname yang diizinkan.

Konfigurasi dasar sudah mengizinkan origin situs GitHub Pages dan batas ukuran 100 MB. Jangan menambahkan host yang tidak kamu percayai.

## Batasan TikTok

Backend ini **bukan pengunduh universal halaman TikTok**. Server secara sengaja menolak halaman TikTok serta domain CDN TikTok; URL postingan biasa bukan URL file video langsung. Gunakan fitur resmi **Bagikan → Simpan video** ketika kreator mengizinkan unduhan. Tool ini dapat mengambil file video langsung dari host yang diizinkan, bukan melewati kontrol unduhan atau proteksi platform.

## Struktur backend

- `backend/worker.js`: implementasi Cloudflare Workers.
- `backend/wrangler.toml`: konfigurasi untuk Wrangler/Cloudflare.
- `backend/server.js`: versi Node.js/Express yang bisa dipakai pada hosting Node lain.
- `backend/README.md`: petunjuk alternatif Render untuk Node.js.
