#!/usr/bin/env sh
# Backups of the Vita database, run on the Docker host.
#   sh vita-backup.sh create            snapshot named vita-<date>-<HHMMSS>.db, keeps the last 7 days
#   sh vita-backup.sh list
#   sh vita-backup.sh restore <file>    stops the app, restores, starts it again
#
# VITA_CONTAINER names the app container (default vita-app-1, i.e.
# <stack name>-app-1). Daily via cron, e.g. at 03:00:
#   0 3 * * * VITA_CONTAINER=vita-app-1 sh /opt/vita/vita-backup.sh create >> /var/log/vita-backup.log 2>&1
set -eu

container="${VITA_CONTAINER:-vita-app-1}"
command="${1:-}"

case "$command" in
  create | list)
    # The snapshot is taken while the app keeps running.
    exec docker exec "$container" node --disable-warning=ExperimentalWarning server/backup.ts "$command"
    ;;
  restore)
    [ -n "${2:-}" ] || { echo "Usage: $0 restore <file>   (a name from \"$0 list\")" >&2; exit 1; }
    image=$(docker inspect -f '{{.Image}}' "$container")
    echo "Stopping $container ..."
    docker stop "$container" >/dev/null
    # The exact image the app runs, with its volumes (/data, /backups) does the restore,
    # so it works the same however the volumes are named. The app is started
    # again even if the restore fails, then on the database it had before.
    status=0
    docker run --rm --volumes-from "$container" "$image" node --disable-warning=ExperimentalWarning server/backup.ts restore "$2" || status=$?
    echo "Starting $container ..."
    docker start "$container" >/dev/null
    exit "$status"
    ;;
  *)
    echo "Usage: $0 create | list | restore <file>" >&2
    exit 1
    ;;
esac
