#!/bin/bash
# CC Monitor Pet — 자동 실행 스크립트
# 네트워크 상태와 무관하게 펫 앱을 실행합니다.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
APP_DIR="/Users/heewon/Documents/cc-monitor-pet"
LOG="/tmp/cc-monitor-pet.log"

echo "[$(date)] CC Monitor Pet 시작 시도" >> "$LOG"

# 앱 디렉토리 확인
if [ ! -d "$APP_DIR" ]; then
  echo "[$(date)] ERROR: 앱 디렉토리 없음: $APP_DIR" >> "$LOG"
  exit 1
fi

cd "$APP_DIR"

# node/npm을 찾을 때까지 대기 (최대 30초)
# 부팅 직후 PATH가 완전히 설정되지 않은 경우를 대비
WAIT=0
while ! command -v node &>/dev/null; do
  if [ $WAIT -ge 30 ]; then
    echo "[$(date)] ERROR: node를 찾을 수 없음" >> "$LOG"
    exit 1
  fi
  sleep 2
  WAIT=$((WAIT + 2))
done

echo "[$(date)] node 확인: $(command -v node)" >> "$LOG"

# 이미 실행 중이면 종료
if pgrep -f "electron.*cc-monitor-pet" &>/dev/null; then
  echo "[$(date)] 이미 실행 중, 종료" >> "$LOG"
  exit 0
fi

# 네트워크 없어도 상관없음 — Electron 앱은 로컬만 사용
echo "[$(date)] 앱 실행 시작" >> "$LOG"
npm start >> "$LOG" 2>&1
echo "[$(date)] 앱 종료 (exit $?)" >> "$LOG"
