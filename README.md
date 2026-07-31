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

## 🚀 Quick Start (Local Development)

The easiest way to get started is by running the foundational services in Docker, and spinning up the frontend and backend locally for fast hot-reloading.

### 1. Prerequisites
- **Node.js** (v18+)
- **Docker** and **Docker Compose**

### 2. Setup Test Media
The system expects media in the `./volumes/media_ro` directory.
```bash
mkdir -p volumes/media_ro/test_folder
# Add some .jpg, .png, or .mp4 files here!
```

### 3. Start Core Services
Boot up Postgres, Redis, and Immich ML:
```bash
docker-compose up -d postgres redis machine-learning
```

### 4. Start the Backend API
```bash
cd backend
npm install
npm run dev
# The API will start on http://localhost:3000
```

### 5. Start the Frontend UI
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173 in your browser
```

---

## 🔐 Default Credentials

When starting the application for the first time, a default administrator account is automatically generated for you.

- **Email:** `admin@example.com`
- **Password:** `admin`

> **Note:** Please change this password immediately after your first login!

---

## 📚 Documentation

For a deep dive into the architecture, deployment, and background worker systems, please read the official [Technical Documentation](tech_docs.md).
