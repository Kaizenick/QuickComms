#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${PROJECT_DIR}/infrastructure"
PURGE_CONFIG=false

if [[ "${1:-}" == "--purge-config" ]]; then
  PURGE_CONFIG=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--purge-config]" >&2
  exit 2
fi

echo "This removes QuickComms deployment resources only."
echo "It does not stop or modify Pi-hole, Judge0, Audiobookshelf, or other applications."
read -r -p "Continue? [y/N] " confirmation
if [[ ! "${confirmation}" =~ ^[Yy]$ ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

cd "${INFRA_DIR}"

if docker compose version >/dev/null 2>&1; then
  docker compose down --volumes --remove-orphans --rmi local
else
  echo "Docker Compose is unavailable; skipping Compose resource cleanup." >&2
fi

remove_ufw_rule() {
  local rule="$1"
  if command -v ufw >/dev/null 2>&1; then
    ufw --force delete allow "${rule}" >/dev/null 2>&1 || true
  fi
}

remove_ufw_rule "8443/tcp"
remove_ufw_rule "8443/udp"
remove_ufw_rule "3478/tcp"
remove_ufw_rule "3478/udp"
remove_ufw_rule "49160:49200/udp"

if [[ "${PURGE_CONFIG}" == true ]]; then
  rm -f -- "${INFRA_DIR}/.env"
  echo "Removed infrastructure/.env."
else
  echo "Preserved infrastructure/.env. Use --purge-config to remove it."
fi

echo "QuickComms cleanup complete."
echo "SSH and ports 80/443 were preserved for existing VM services."
