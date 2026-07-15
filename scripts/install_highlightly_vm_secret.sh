#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/etc/asp-scraper-api.env}"
SERVICE="${HIGHLIGHTLY_SERVICE_NAME:-asp-scraper-api}"

if [[ ! -f "$TARGET" ]]; then
  echo "Environment file not found: $TARGET" >&2
  exit 1
fi

read -r -s -p "New Highlightly API key: " HIGHLIGHTLY_API_KEY
echo
if [[ ! "$HIGHLIGHTLY_API_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
  echo "The key format is invalid or too short." >&2
  unset HIGHLIGHTLY_API_KEY
  exit 1
fi

TMP_FILE="$(mktemp)"
cleanup() {
  unset HIGHLIGHTLY_API_KEY
  rm -f "$TMP_FILE"
}
trap cleanup EXIT
chmod 600 "$TMP_FILE"

sudo cat "$TARGET" > "$TMP_FILE"
sed -i \
  -e '/^HIGHLIGHTLY_API_KEY=/d' \
  -e '/^HIGHLIGHTLY_BASE_URL=/d' \
  -e '/^HIGHLIGHTLY_ANALYSIS_ENABLED=/d' \
  "$TMP_FILE"

{
  printf '\nHIGHLIGHTLY_API_KEY=%s\n' "$HIGHLIGHTLY_API_KEY"
  printf 'HIGHLIGHTLY_BASE_URL=https://sports.highlightly.net\n'
  printf 'HIGHLIGHTLY_ANALYSIS_ENABLED=false\n'
} >> "$TMP_FILE"

sudo install -o root -g root -m 600 "$TMP_FILE" "$TARGET"
unset HIGHLIGHTLY_API_KEY
sudo systemctl restart "$SERVICE"

if [[ "$(systemctl is-active "$SERVICE")" != "active" ]]; then
  echo "Service failed to return to active state." >&2
  exit 1
fi

echo "Highlightly secret installed; rollout flag remains disabled."
