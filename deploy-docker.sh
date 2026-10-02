#!/usr/bin/env bash
# Build and start Go API, Go worker and TypeScript Agent from this checkout.
set -euo pipefail
cd "$(dirname "$0")"
for config_file in apps/server/.env apps/agent/.env; do
  if [[ ! -f "$config_file" ]]; then
    echo "Missing $config_file; configure it from the matching .env.example (see DEPLOYMENT.md)." >&2
    exit 1
  fi
done
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null
docker compose -f infra/docker/docker-compose.app.yml up -d --build "$@"
