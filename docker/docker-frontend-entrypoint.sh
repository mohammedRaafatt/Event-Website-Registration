#!/bin/sh
set -e

API_BASE="${API_BASE:-http://localhost:5001/api}"
API_BASE_ESC=$(printf '%s' "$API_BASE" | sed "s/'/'\\\\''/g")

printf '%s\n' "(function (w) {
  if (typeof w === 'undefined') return;
  w.__API_BASE__ = '${API_BASE_ESC}';
})(typeof window !== 'undefined' ? window : globalThis);" > /usr/share/nginx/html/js/site-config.js

exec "$@"
