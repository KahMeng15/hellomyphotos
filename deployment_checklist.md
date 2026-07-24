# Pre-Deployment Checklist

Before deploying this monolithic stack to a production server, walk through this critical checklist to ensure stability, security, and performance.

## 1. Environment Variables & Security
- [ ] Ensure `.env` is fully populated and **never** committed to version control.
- [ ] Change `POSTGRES_PASSWORD` and `DB_PASS` to a secure, randomly generated string.
- [ ] Configure `VITE_API_URL` to point to your production backend domain (e.g., `https://api.mygallery.com`).
- [ ] Configure `REDIS_PASSWORD` if exposing Redis outside the Docker network.

## 2. Docker & Volume Mounts
- [ ] Verify that your primary media volume is strictly mounted as Read-Only (`:ro`) in `docker-compose.yml` to prevent accidental deletions of your original files.
- [ ] Verify that `cache_rw` has the correct read/write permissions for the Docker user.
- [ ] Set resource constraints in `docker-compose.yml` (e.g., `mem_limit` or `cpus`) so that `sharp` and `ffmpeg` workers do not completely starve the host server OS.

## 3. Reverse Proxy & SSL (e.g., Caddy, Nginx, Traefik)
- [ ] Ensure the backend (`port 3000`) and frontend (`port 5173` or SvelteKit node adapter port) are cleanly proxied.
- [ ] Configure SSL/TLS certificates (e.g., Let's Encrypt).
- [ ] Ensure the reverse proxy accepts `Range` headers properly so that HTTP Video Streaming works correctly on Apple/Safari devices.
- [ ] Ensure the proxy `client_max_body_size` is large enough if you ever plan on building a direct web upload feature.

## 4. Backend Processing & Load Testing
- [ ] Validate `settings:max_cpu_cores` in the Admin Dashboard. Do not set this higher than your physical CPU cores, or you will experience severe throttling during mass uploads.
- [ ] Test the background cron job (`analyticsCron`) to ensure Redis views are successfully flushing to PostgreSQL.
- [ ] Run a test scan on a massive directory (e.g., 20,000 files) and monitor RAM consumption. If Fastify crashes due to OOM (Out Of Memory), you may need to implement pagination/batching in the `ScannerService.scanDirectory` array loops.

## 5. Machine Learning Thresholds
- [ ] Test the pgvector clustering query (`<=> $1::vector < 0.6`). If faces are grouping incorrectly (false positives), adjust the distance threshold to `0.5`. If it's failing to group identical people (false negatives), increase it to `0.65`.

## 6. Backup Strategy
- [ ] Create a cron job on the host to run `pg_dump` on the `hellomyphotos` database daily.
- [ ] You do **not** need to backup the `cache_rw` volume, as it can be perfectly reconstructed by deleting it and triggering a new scan. 
