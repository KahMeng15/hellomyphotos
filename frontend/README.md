# hellomyphotos Frontend 🎨

The user interface for **hellomyphotos**, built with [SvelteKit](https://kit.svelte.dev/) (Svelte 5), Tailwind CSS, and a performant virtualized grid designed to render thousands of media items smoothly without browser lag.

---

## 🏗️ Architecture & Features

- **Virtualized Media Grid**: High-performance photo gallery rendering thousands of assets with low DOM overhead using virtual scrolling and Blurhash placeholders.
- **Lightbox Viewer**: Rich media preview supporting 1080p WebP display, direct HTTP range video streaming, EXIF metadata inspection, and instant toggle between standard and Low-Bandwidth (480p) mode.
- **Semantic Smart Search**: Search photos via natural language powered by CLIP vector embeddings.
- **Facial Recognition & People**: Clustered face gallery with person name editing, cover photo selection, and person merging.
- **Timeline Feed**: Chronological stream grouping photos by year and month from EXIF capture metadata.
- **Granular Share Viewer**: Public folder, single-media, and person sharing with password protection, folder ZIP downloads, compact list view, and expired link access request modal.
- **Admin Management Suite**:
  - **Queues (`/admin/queues`)**: Live BullMQ queue inspection, retry, clear, and batch processing controls.
  - **Watermark Studio (`/admin/watermark`)**: Interactive watermark designer with SVG live preview, font selection, anchor positioning, and restricted download tiers.
  - **Analytics (`/admin/analytics`)**: Visitor charts, device/browser breakdown, GeoIP country/city maps, and cache bandwidth savings.
  - **Shares (`/admin/shares`)**: Link management and pending access request reviews.
  - **Faces (`/admin/faces`)**: Face cluster merging and management.
  - **Users (`/admin/users`)**: User accounts and folder RBAC permissions.
  - **System Logs (`/admin/logs`)**: Live application and system error logs.
  - **Settings (`/admin/settings`)**: CPU concurrency, scan intervals, lockdown mode, and mailer settings.

---

## 📁 Directory Structure

```text
frontend/
├── src/
│   ├── lib/
│   │   ├── actions/       # Svelte actions (click-outside, intersection observers)
│   │   ├── api/           # Typed API clients for Fastify backend endpoints
│   │   ├── components/    # Reusable UI components (Lightbox, Grid, Modals, Nav, etc.)
│   │   ├── stores/        # Svelte state stores (auth, settings, low-bandwidth mode)
│   │   └── utils/         # Helper functions (blurhash, formatting, date helpers)
│   ├── routes/
│   │   ├── +layout.svelte # Root layout, global navigation, and authentication state
│   │   ├── folder/        # Directory-first folder browser (`[...path]`)
│   │   ├── timeline/      # Chronological photo feed
│   │   ├── search/        # Semantic CLIP natural-language search
│   │   ├── people/        # People cluster gallery and person view (`[id]`)
│   │   ├── share/         # Public shared view (`[token]`) with access request modal
│   │   ├── admin/         # Admin management dashboards
│   │   ├── settings/      # User preferences and low-bandwidth toggles
│   │   └── login/         # Authentication and Cloudflare Turnstile verification
│   └── static/            # Static assets and web fonts (Cabinet Grotesk, Instrument Sans)
├── svelte.config.js
├── vite.config.ts
└── package.json
```

---

## 🛠️ Local Development

### Prerequisites
- **Node.js**: v18 or newer (v22 recommended)
- **Fastify Backend**: Running on `http://localhost:3000` (or Docker dev container)

### Setup & Run
```bash
# Install dependencies
npm install

# Start Vite dev server with hot module replacement (HMR)
npm run dev

# Or bind to 0.0.0.0 for external testing
npm run dev -- --host
```

By default, Vite runs at `http://localhost:5173` (or `http://localhost:8000` inside Docker) and proxies `/api/*` requests to `BACKEND_PROXY_URL` (defaults to `http://localhost:3000` or `http://backend:3000`).

### Production Build
```bash
# Build the production bundle with @sveltejs/adapter-node
npm run build

# Preview the built production server
npm run preview
```

---

## ⚙️ Environment Variables

The frontend reads configuration from environment variables:
- `BACKEND_PROXY_URL`: Target URL for the internal Fastify backend (e.g. `http://backend:3000`).
- `PUBLIC_APP_DOMAIN`: Canonical public domain used for absolute links and share tokens.
- `TURNSTILE_SITEKEY`: Cloudflare Turnstile public site key served dynamically at runtime.
