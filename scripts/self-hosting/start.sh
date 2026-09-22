#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

APP_URL="${APP_URL:-http://localhost:3000}"
TIMEOUT_SECONDS=60

cd "$PROJECT_ROOT"

echo "🚀 Starting Reactive Resume..."
echo

if ! command -v docker >/dev/null 2>&1; then
	echo "❌ Docker is not installed or not available in PATH."
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	echo "❌ Docker Compose is not available."
	exit 1
fi

echo "✔ Docker and Docker Compose are available."
echo

docker compose up -d

echo
echo "⏳ Waiting for Reactive Resume to become ready..."

start_time="$SECONDS"

while true; do
	container_id="$(docker compose ps -q reactive_resume)"

	if [ -n "$container_id" ]; then
		health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"

		if [ "$health_status" = "healthy" ]; then
			break
		fi
	fi

	if (( SECONDS - start_time >= TIMEOUT_SECONDS )); then
		echo
		echo "❌ Reactive Resume did not become ready within ${TIMEOUT_SECONDS} seconds."
		echo
		echo "Docker Compose status:"
		docker compose ps
		echo
		echo "Reactive Resume logs:"
		docker compose logs --tail=50 reactive_resume
		exit 1
	fi

	printf "."
	sleep 2
done

echo
echo
echo "✔ Reactive Resume is ready!"
echo
echo "🌐 $APP_URL"
echo

if command -v xdg-open >/dev/null 2>&1; then
	xdg-open "$APP_URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
	open "$APP_URL" >/dev/null 2>&1 &
else
	echo "Open $APP_URL in your browser."
fi
