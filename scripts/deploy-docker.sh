#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_PROJECT="olai"
readonly SERVICE="olai"
readonly CONTAINER="olai"
readonly DATA_VOLUME="olai-data"

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-docker.sh <image>

Example:
  bash scripts/deploy-docker.sh ghcr.io/plunjoin/olai:1.4.0
EOF
}

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

new_image="${1:-}"
if [[ -z "$new_image" ]]; then
  usage
  exit 2
fi
if [[ "$new_image" == -* || ! "$new_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]; then
  die "Image reference contains unsupported characters."
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_dir="$(cd -- "$script_dir/.." && pwd -P)"
cd "$repo_dir"

command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "Cannot connect to the Docker daemon."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
[[ -f .env ]] || die ".env is missing. Copy .env.example to .env first."
[[ -f docker-compose.yml ]] || die "docker-compose.yml is missing."

old_image=""
was_running=false
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  old_image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")"
  project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER" 2>/dev/null || true)"
  if [[ "$project" != "$COMPOSE_PROJECT" ]]; then
    die "Container '$CONTAINER' is not managed by Compose project '$COMPOSE_PROJECT'. Back up olai-data, then run 'docker stop olai && docker rm olai' once before the first Compose deployment."
  fi
  was_running="$(docker inspect --format '{{.State.Running}}' "$CONTAINER")"
fi

mkdir -p .deploy backups
if [[ -n "$old_image" ]]; then
  printf '%s\n' "$old_image" > .deploy/previous-image
fi

log "Pulling $new_image"
docker pull "$new_image"

database_url="$(
  { grep -E '^[[:space:]]*DATABASE_URL=' .env 2>/dev/null || true; } \
    | tail -n 1 \
    | cut -d= -f2- \
    | tr -d '\r' \
    | sed -e "s/^[\"']//" -e "s/[\"']$//"
)"
remote_database=false
if [[ "$database_url" == postgres://* || "$database_url" == postgresql://* ]]; then
  remote_database=true
fi

backup_path=""
if [[ "$remote_database" == true ]]; then
  log "PostgreSQL detected; the docker volume does not contain the database."
  log "Ensure a pg_dump backup exists before relying on an application rollback."
elif docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  if [[ "$was_running" == true ]]; then
    log "Stopping $CONTAINER for a consistent data backup"
    docker stop "$CONTAINER" >/dev/null
  fi

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_name="olai-data-${stamp}.tar.gz"
  backup_path="$repo_dir/backups/$backup_name"
  log "Backing up $DATA_VOLUME to backups/$backup_name"
  backup_ok=true
  docker run --rm --user 0:0 --entrypoint tar \
    -v "$DATA_VOLUME:/data:ro" \
    -v "$repo_dir/backups:/backup" \
    "$new_image" \
    -C /data -czf "/backup/$backup_name" . || backup_ok=false
  if [[ "$backup_ok" != true || ! -s "$backup_path" ]]; then
    rm -f "$backup_path" 2>/dev/null || true
    if [[ "$was_running" == true ]]; then
      log "Backup failed; restarting the old container"
      docker start "$CONTAINER" >/dev/null 2>&1 || true
    fi
    die "Data backup failed; deployment aborted."
  fi
else
  log "Volume $DATA_VOLUME does not exist yet; skipping the pre-deploy backup."
fi

wait_for_health() {
  local timeout_seconds="$1"
  local deadline=$((SECONDS + timeout_seconds))
  local container_id="" state=""

  while (( SECONDS < deadline )); do
    container_id="$(docker compose ps -q "$SERVICE" 2>/dev/null || true)"
    if [[ -z "$container_id" ]]; then
      state="missing"
    else
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || echo missing)"
    fi
    case "$state" in
      healthy)
        return 0
        ;;
      unhealthy|exited|dead|missing)
        log "Container state is $state"
        docker compose logs --tail=100 "$SERVICE" || true
        return 1
        ;;
    esac
    sleep 3
  done

  log "Health check timed out after ${timeout_seconds}s (last state: ${state:-unknown})"
  docker compose logs --tail=100 "$SERVICE" || true
  return 1
}

rollback() {
  local reason="$1"
  log "Deployment failed: $reason"
  if [[ -z "$old_image" ]]; then
    log "No previous image is available for automatic rollback."
    return 1
  fi

  log "Rolling back to $old_image"
  if ! OLAI_IMAGE="$old_image" docker compose up -d --no-deps --force-recreate "$SERVICE"; then
    log "Automatic rollback failed to start the previous image."
    return 1
  fi
  if ! wait_for_health 120; then
    log "Previous image also failed its health check. Manual intervention is required."
    return 1
  fi
  printf '%s\n' "$old_image" > .deploy/current-image
  log "Rollback succeeded; the previous image is running."
  return 0
}

log "Deploying $new_image"
export OLAI_IMAGE="$new_image"
if ! docker compose up -d --no-deps --force-recreate "$SERVICE"; then
  rollback "compose up failed" || true
  exit 1
fi

log "Waiting for the container health check (up to 180s)"
if ! wait_for_health 180; then
  rollback "new image did not become healthy" || true
  exit 1
fi

printf '%s\n' "$new_image" > .deploy/current-image
date -u +%Y-%m-%dT%H:%M:%SZ > .deploy/deployed-at
log "Deployment succeeded: $new_image"
if [[ -n "$backup_path" ]]; then
  log "Pre-deploy backup: $backup_path"
fi
