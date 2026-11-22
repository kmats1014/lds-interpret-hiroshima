#!/bin/zsh
# GraceInterpret — ワンクリック終了スクリプト (Mac用)
# 裏で動いているローカルサーバー (ポート8080) を安全に停止します。

PORT=8080
PIDS=$(lsof -Pi :${PORT} -sTCP:LISTEN -t 2>/dev/null)

if [ -n "${PIDS}" ]; then
  kill ${PIDS} 2>/dev/null
  echo "✅ 同時通訳アプリのサーバー（ポート ${PORT}）を終了しました。"
else
  echo "ℹ️ 現在起動中のアプリサーバーはありません。"
fi

sleep 1
