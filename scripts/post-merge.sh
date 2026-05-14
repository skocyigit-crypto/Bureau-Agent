#!/bin/bash
set -e
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter db push-force
