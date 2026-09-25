#!/bin/sh
cd "$(dirname "$0")"
if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
nohup npm run dev > /tmp/poin-dev.log 2>&1 &
exit 0
