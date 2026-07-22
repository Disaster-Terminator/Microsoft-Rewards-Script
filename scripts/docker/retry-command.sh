#!/bin/sh

set -eu

if [ "$#" -lt 2 ]; then
    echo "Usage: retry-command <attempts> <command> [args...]" >&2
    exit 2
fi

max_attempts=$1
shift
command_name=$1
attempt=1

while ! "$@"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "Command failed after $attempt attempt(s): $command_name" >&2
        exit 1
    fi

    delay=$((attempt * 5))
    echo "Command failed on attempt $attempt; retrying in ${delay}s: $command_name" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
done
