#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${PROJECT_DIR}/infrastructure"
PURGE_CONFIG=false
REMOVE_FIREWALL=false

usage() {
  cat <<EOF
Usage: $0 [--purge-config] [--remove-firewall]

Removes resources declared by the QuickComms Docker Compose project.

Options:
  --purge-config     Also delete infrastructure/.env.
  --remove-firewall Remove the documented QuickComms UFW port rules.
  -h, --help         Show this help message.

Firewall removal is opt-in because another application may share a port.
EOF
}

for argument in "$@"; do
  case "${argument}" in
    --purge-config)
      PURGE_CONFIG=true
      ;;
    --remove-firewall)
      REMOVE_FIREWALL=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: ${argument}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${INFRA_DIR}/docker-compose.yml" ]]; then
  echo "QuickComms Compose file not found: ${INFRA_DIR}/docker-compose.yml" >&2
  exit 1
fi

echo "This removes only resources declared by this QuickComms Compose project:"
echo "  - QuickComms containers and project networks"
echo "  - QuickComms named volumes"
echo "  - Images built locally by this Compose project"
if [[ "${REMOVE_FIREWALL}" == true ]]; then
  echo "  - Documented QuickComms UFW rules (explicitly requested)"
fi
if [[ "${PURGE_CONFIG}" == true ]]; then
  echo "  - infrastructure/.env (explicitly requested)"
fi
echo "Unrelated Docker projects, containers, images, volumes, and host services are not targeted."
read -r -p "Continue? [y/N] " confirmation
if [[ ! "${confirmation}" =~ ^[Yy]$ ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

cd "${INFRA_DIR}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose down --volumes --remove-orphans --rmi local
else
  echo "Docker Compose is unavailable; cannot remove QuickComms Compose resources." >&2
  exit 1
fi

remove_ufw_rule() {
  local rule="$1"
  if command -v ufw >/dev/null 2>&1; then
    if [[ "${EUID}" -eq 0 ]]; then
      ufw --force delete allow "${rule}" >/dev/null 2>&1 || true
    elif command -v sudo >/dev/null 2>&1; then
      sudo ufw --force delete allow "${rule}" >/dev/null 2>&1 || true
    else
      echo "Cannot remove UFW rule ${rule}: run as root or install sudo." >&2
    fi
  fi
}

if [[ "${REMOVE_FIREWALL}" == true ]]; then
  remove_ufw_rule "8443/tcp"
  remove_ufw_rule "8443/udp"
  remove_ufw_rule "3478/tcp"
  remove_ufw_rule "3478/udp"
  remove_ufw_rule "49160:49200/udp"
  echo "Requested QuickComms UFW rule cleanup complete."
else
  echo "Firewall rules preserved. Use --remove-firewall to remove the documented QuickComms UFW rules."
fi

if [[ "${PURGE_CONFIG}" == true ]]; then
  rm -f -- "${INFRA_DIR}/.env"
  echo "Removed infrastructure/.env."
else
  echo "Preserved infrastructure/.env. Use --purge-config to remove it."
fi

echo "QuickComms cleanup complete."
