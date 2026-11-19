#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/volumes/geoip"
mkdir -p "$DEST_DIR"

echo "Downloading MaxMind GeoLite2 databases to $DEST_DIR..."

if [ -n "${MAXMIND_LICENSE_KEY:-}" ]; then
  echo "Using MaxMind License Key..."
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT
  
  curl -fsSL "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" | tar -xz -C "$TMP_DIR"
  find "$TMP_DIR" -name "GeoLite2-City.mmdb" -exec mv {} "$DEST_DIR/" \;
  
  curl -fsSL "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-ASN&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" | tar -xz -C "$TMP_DIR"
  find "$TMP_DIR" -name "GeoLite2-ASN.mmdb" -exec mv {} "$DEST_DIR/" \;
else
  echo "Downloading from GitHub mirror..."
  curl -fSL -o "$DEST_DIR/GeoLite2-City.mmdb" "https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"
  curl -fSL -o "$DEST_DIR/GeoLite2-ASN.mmdb" "https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-ASN.mmdb"
fi

echo "Done! GeoIP databases installed successfully in $DEST_DIR"
