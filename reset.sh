#!/bin/bash

echo "🚨 WARNING: This will completely reset the application."
echo "All databases, caches, faces, and thumbnails will be permanently deleted."
echo "Your original media files in volumes/media_ro will NOT be touched."
echo ""
read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "🛑 Stopping all containers..."
    # Bring down both dev and prod containers just in case, and remove anonymous volumes
    docker compose down -v 2>/dev/null
    docker compose -f docker-compose.dev.yml down -v 2>/dev/null

    echo "🧹 Wiping database and caches..."
    # Remove the contents of the stateful directories but keep the directories themselves
    rm -rf volumes/pg_data/*
    rm -rf volumes/redis_data/*
    rm -rf volumes/ml_cache/*
    rm -rf volumes/cache_rw/*

    echo "✅ Reset complete! You can now start fresh."
else
    echo "Reset cancelled."
fi
