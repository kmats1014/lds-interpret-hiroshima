#!/bin/zsh
# GraceInterpret — ワンクリック起動スクリプト (Mac用)
# このファイルをダブルクリックするだけで、ローカルサーバーを起動してブラウザでアプリを開きます。

cd "$(dirname "$0")" || exit 1

PORT=8080
URL="http://localhost:${PORT}"

echo "=================================================="
echo "  GraceInterpret（同時通訳アプリ）を起動しています..."
echo "  URL: ${URL}"
echo "=================================================="

# すでにポート8080で起動中かチェック
if lsof -Pi :${PORT} -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✅ サーバーはすでに起動しています。ブラウザを開きます..."
  open "${URL}"
  exit 0
fi

# 1秒後にブラウザで自動的にページを開く
(sleep 1 && open "${URL}") &

echo "💡 使用中は、このウィンドウを閉じずにそのままにしておいてください。"
echo "💡 終了するときは、このウィンドウを閉じるか Ctrl + C を押してください。"
echo ""

python3 -m http.server ${PORT}
