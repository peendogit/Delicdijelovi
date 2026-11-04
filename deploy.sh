#!/bin/bash
# Automatsko ažuriranje sa GitHuba. Za cron (svaki minut):
#   * * * * * /var/www/delicdijelovi/deploy.sh >> /var/log/delicdijelovi-deploy.log 2>&1
cd "$(dirname "$0")" || exit 1
git fetch -q origin main || exit 0
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "$(date '+%F %T') ažuriram $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"
  git stash -q 2>/dev/null
  git merge -q --ff-only origin/main || git reset -q --hard origin/main
  [ package.json -nt node_modules ] && npm install --omit=dev --no-audit --no-fund -q
  pm2 restart delic-dijelovi --update-env >/dev/null && echo "$(date '+%F %T') restartovano"
fi
