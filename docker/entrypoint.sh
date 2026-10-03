#!/bin/sh
# FIG-595: runs once per container start, before handing off to the real
# command (`npm run start` by default -- see the Dockerfile's CMD).
#
# Migrations and role provisioning are gated behind RUN_MIGRATIONS_ON_START
# rather than always running: with more than one replica, every container
# would otherwise race to run `prisma migrate deploy` concurrently on
# startup. Run this exactly once per deploy -- either by setting this flag
# on a single one-off task/container before starting the real replicas, or
# by using this same image with an explicit command for that one-off step
# (see docs/DEPLOYMENT.md's deploy sequence). Ordinary replicas should
# start with this flag unset.
set -e

if [ "$RUN_MIGRATIONS_ON_START" = "true" ]; then
  echo "[entrypoint] Applying migrations..."
  npx prisma migrate deploy

  echo "[entrypoint] Bootstrapping the figbloom_app role..."
  npx tsx scripts/db-admin.ts bootstrap-role

  echo "[entrypoint] Granting figbloom_app privileges..."
  npx tsx scripts/db-admin.ts grant-role
fi

exec "$@"
