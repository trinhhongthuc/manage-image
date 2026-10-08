#!/bin/bash

set -e

# Check files changed in the latest commit.
CHANGED_FILES=$(git diff --name-only HEAD^ HEAD)

echo "Changed files:"
echo "$CHANGED_FILES"

# If every changed file is metadata-only, skip Vercel build.
if [ -n "$CHANGED_FILES" ] && \
   ! echo "$CHANGED_FILES" | grep -vE '^(metadata/|data/images\.json$|config/telegram-state\.json$)' > /dev/null
then
  echo "Only metadata files changed."
  echo "Skipping Vercel build."
  exit 0
fi

echo "Application code changed."
echo "Proceeding with Vercel build."
exit 1
