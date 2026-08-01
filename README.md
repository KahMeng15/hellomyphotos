# hellomyphotos 📸

A beautiful, self-hosted, directory-first photo management gallery engine. It reads directly from your existing disk folder hierarchies without moving or duplicating files, bringing Google Photos-like speed and AI capabilities to your local storage.

---

## 🌟 Key Features

- **Directory-First Engine**: Leave your folders exactly as they are. hellomyphotos scans your media on-demand without modifying original files.
- **High Performance**: Optimized virtualized grid capable of smoothly rendering thousands of thumbnails.
- **AI Facial Recognition**: Powered by Immich ML, automatically clusters and organizes your photos by person using `pgvector`.
- **Dynamic Watermarking**: Create secure, expiring public share links with on-the-fly watermarking.
- **Low-Bandwidth Mode**: Switch to 480p delivery for mobile data savings.
- **Robust Tech Stack**: Built with SvelteKit, Fastify, PostgreSQL, and Redis.

---

## 🚀 Quick Start (Docker Hot-Reloading)

We use a fully containerized Docker setup that includes **live hot-reloading** for both the frontend and backend. You get the exact environment parity of Docker, but with the instant feedback loop of local development!

### 1. Prerequisites
- **Docker** and **Docker Compose**

### 2. Setup Test Media
The system expects media in the `./volumes/media_ro` directory.
```bash
mkdir -p volumes/media_ro/test_folder
# Add some .jpg, .png, or .mp4 files here!
```

### 3. Start the Environment
Boot up the entire stack in one command using the development configuration:
```bash
docker compose -f docker-compose.dev.yml up -d
```
*Note: We use Docker bind mounts mapping your `./frontend` and `./backend` directories directly into the containers. Any time you save a file in your code editor on your host machine, the containers will instantly hot-reload!*

### 4. Access the Application
- **Frontend UI:** [http://localhost:8000](http://localhost:8000)
- **Backend API:** [http://localhost:8001](http://localhost:8001)

### 5. Stop the Environment
```bash
docker compose down
```

---

## 💻 Non-Docker Local Development
If you prefer running the Node processes directly on your Mac (e.g. `npm run dev`) without Docker:

1. Ensure your local `backend/.env.local` contains the correct port mappings for your running Docker services:
```env
DB_PORT=8002
REDIS_PORT=8003
IMMICH_ML_URL=http://localhost:8004
```
2. Start the core services only: `docker compose up -d postgres redis machine-learning`
3. Run `npm install` and `npm run dev` in both `./frontend` and `./backend`.

---

## 🔐 Default Credentials

When starting the application for the first time, a default administrator account is automatically generated for you.

- **Email:** `admin@example.com`
- **Password:** `admin`

> **Note:** Please change this password immediately after your first login!

---

## 📚 Documentation

For a deep dive into the architecture, deployment, and background worker systems, please read the official [Technical Documentation](tech_docs.md).
