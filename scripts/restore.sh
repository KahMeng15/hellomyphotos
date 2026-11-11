#!/usr/bin/env bash
set -euo pipefail

# Directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <path-to-backup-file.sql.gz>"
  echo ""
  echo "Available backups in volumes/backups/daily:"
  ls -lh "${ROOT_DIR}/volumes/backups/daily/"*.sql.gz 2>/dev/null || echo "No daily backups found."
  echo ""
  echo "Latest backup link:"
  ls -lh "${ROOT_DIR}/volumes/backups/last/"*.sql.gz 2>/dev/null || echo "No latest backup found."
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file '${BACKUP_FILE}' not found."
  exit 1
fi

echo "================================================================="
echo "WARNING: This will restore the database from: ${BACKUP_FILE}"
echo "Current database data will be overwritten!"
echo "================================================================="
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

cd "${ROOT_DIR}"

# Source .env
source .env

POSTGRES_USER="${POSTGRES_USER:-hellomyphotos}"
POSTGRES_DB="${POSTGRES_DB:-hellomyphotos}"

echo "Stopping backend services to prevent database access during restore..."
docker compose stop backend backend-worker frontend || true

echo "Restoring database from compressed dump..."
gunzip -c "${BACKUP_FILE}" | docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "Restarting backend services..."
docker compose start backend backend-worker frontend

echo "Database restore completed successfully!"
