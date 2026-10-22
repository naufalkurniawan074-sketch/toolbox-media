# Toolbox Media

Website media-tools statis: https://naufalkurniawan074-sketch.github.io/toolbox-media/

## Deploy the backend to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/naufalkurniawan074-sketch/toolbox-media)

1. Open the Deploy to Render button and sign in.
2. Confirm the GitHub repository `naufalkurniawan074-sketch/toolbox-media`.
3. Review the Blueprint. It creates the Node.js web service from the `backend/` folder using `render.yaml`.
4. Click **Deploy Blueprint**.
5. Once the service is live, copy the service's HTTPS URL. Test `https://YOUR-SERVICE.onrender.com/health`.
6. In Render → service → Environment, add `ALLOWED_MEDIA_HOSTS` with the hostname of the direct video-file host you own or have permission to download from (hostname only, no scheme or path). Save and redeploy.
7. In the Toolbox website, enter the endpoint `https://YOUR-SERVICE.onrender.com/api/download-direct` and a direct HTTPS URL to an allowed video file.

## Important limitation

This backend downloads only direct video-file URLs (such as MP4/WebM) from hostnames listed in `ALLOWED_MEDIA_HOSTS`. It intentionally rejects TikTok page URLs and TikTok CDN hosts; it is not a universal TikTok downloader. For TikTok posts, use the platform's **Share → Save video** option when the creator allows it. The official TikTok developer APIs do not provide a universal endpoint to download any public post from its share URL.

See [backend/README.md](backend/README.md) for API behavior and deployment details.
