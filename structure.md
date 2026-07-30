# Project File Structure

This outlines the monolithic monorepo directory layout for both the **SvelteKit** frontend and **Fastify** backend, alongside Docker configuration and volume mappings.

```text
/hellomyphotos
├── docker-compose.yml         # Defines Postgres, Redis, Immich ML, Frontend, and Backend containers
├── .env                       # Environment variables for database credentials, ports, etc.
├── .gitignore                 # Ignores node_modules, generated volumes, and .env
│
├── /volumes                   # Local docker volume mounts (should be gitignored)
│   ├── /media_ro              # Read-only original media (from host file system)
│   ├── /cache_rw              # Read-write dedicated cache volume (WebPs, Blurhashes)
│   ├── /pg_data               # PostgreSQL persistent storage
│   └── /redis_data            # Redis persistent storage
│
├── /frontend                  # SvelteKit Application
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   ├── tailwind.config.js     # Assuming standard styling tool
│   └── /src
│       ├── app.html
│       ├── app.css
│       ├── /lib
│       │   ├── /components    
│       │   │   ├── /grid      # Virtualized infinite-scroll grid components
│       │   │   ├── /lightbox  # Fullscreen photo viewer and video player
│       │   │   └── /faces     # ML face clustering UI components
│       │   ├── /stores        # Svelte stores (e.g., auth state, bandwidth toggle)
│       │   └── /api           # Typed Fetch wrappers to communicate with backend
│       └── /routes
│           ├── +layout.svelte 
│           ├── +page.svelte             # Root Landing Page
│           ├── /folder/[...path]        # Dynamic directory routing (Core View)
│           ├── /share/[token]           # Public share view (password protected / watermarked)
│           └── /admin                   # Admin dashboard (scan settings, worker limits)
│
└── /backend                   # Node.js / Fastify / TypeScript Application
    ├── package.json
    ├── tsconfig.json
    ├── Dockerfile             # Multi-stage Dockerfile for backend + sharp/ffmpeg dependencies
    └── /src
        ├── server.ts              # Entry point (listens on port)
        ├── app.ts                 # Fastify instance initialization and plugin registration
        ├── routes.ts              # Global route registry
        ├── /config                # Environment validation (e.g., zod) and constants
        ├── /db                    # Migrations and database connection pooling
        ├── /modules               # Domain-driven feature modules
        │   ├── /scanner           # On-demand trigger, cron scanner, symlink checks, GC
        │   ├── /media             # Sharp resizing, FFmpeg thumbs, HTTP range streaming
        │   ├── /ml                # Immich ML REST client, pgvector clustering queries
        │   ├── /shares            # Share token auth, dynamic watermarking streams
        │   └── /analytics         # Redis HINCRBY buffering and pg batch flushing
        ├── /queue                 # BullMQ worker initialization and job handlers
        └── /utils                 # Shared helpers (logger, error handlers)
```
