#!/usr/bin/env bash
set -euo pipefail

# Directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Hellomyphotos Manual Database Backup ==="
cd "${ROOT_DIR}"

# Trigger immediate backup via running db-backup container if available
if docker compose ps db-backup 2>/dev/null | grep -q "Up"; then
  echo "Triggering backup inside db-backup container..."
  docker compose exec db-backup /backup.sh
else
  echo "db-backup service is not running. Starting a temporary backup job..."
  docker compose run --rm db-backup /backup.sh
fi

echo ""
echo "Backup complete! Current backups stored in volumes/backups/:"
ls -lh "${ROOT_DIR}/volumes/backups/daily" 2>/dev/null || true
echo "============================================="
