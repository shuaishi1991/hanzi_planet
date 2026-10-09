#!/bin/sh
cd "$(dirname "$0")"
echo "启动中…请在浏览器打开 http://localhost:8000"
python3 -m http.server 8000
