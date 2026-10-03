#!/bin/sh
set -eu

# Use a matching official runtime when Docker Hub cannot serve the Node base.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
version=$(node -p "require('$source_dir/package.json').version")
base_image=${MRS_BASE_IMAGE:-ghcr.io/thenetsky/microsoft-rewards-script:$version}
image=${MRS_IMAGE:-gateway/microsoft-rewards-script:$version-local}

cd "$source_dir"
pnpm run build
context=$(mktemp -d)
trap 'rm -rf "$context"' EXIT
cp -R dist "$context/dist"
cp scripts/docker/run_daily.sh "$context/run_daily.sh"
printf 'ARG BASE_IMAGE=%s\n' "$base_image" > "$context/Dockerfile"
cat >> "$context/Dockerfile" <<'EOF'
FROM ${BASE_IMAGE}
COPY dist/ /usr/src/microsoft-rewards-script/dist/
COPY --chmod=755 run_daily.sh /usr/src/microsoft-rewards-script/scripts/docker/run_daily.sh
EOF
docker build --build-arg "BASE_IMAGE=$base_image" -t "$image" "$context"
