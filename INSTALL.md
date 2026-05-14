# cc-monitor-pet 설치

Claude Code 활동을 시각화하는 macOS 데스크탑 펫입니다.
macOS Apple Silicon(M1/M2/M3/M4), bash / zsh 환경을 기준으로 합니다.

---

## Step 0. 사전 확인

아래 명령어를 실행하세요. 하나라도 실패하면 **즉시 중단하고 사용자에게 안내하세요.**

```bash
# macOS 확인
[ "$(uname)" = "Darwin" ] || { echo "ERROR: macOS 전용입니다."; exit 1; }

# Apple Silicon 확인 (Intel Mac은 지원 안 함)
[ "$(uname -m)" = "arm64" ] || { echo "ERROR: Apple Silicon(arm64) 전용입니다. 현재 아키텍처: $(uname -m)"; exit 1; }

# 필수 도구 확인
command -v curl >/dev/null || { echo "ERROR: curl이 없습니다."; exit 1; }
command -v hdiutil >/dev/null || { echo "ERROR: hdiutil이 없습니다 (macOS 기본 도구)."; exit 1; }
command -v node >/dev/null || { echo "ERROR: Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 설치 후 다시 시도하세요."; exit 1; }
command -v npm >/dev/null  || { echo "ERROR: npm이 없습니다."; exit 1; }
command -v git >/dev/null  || { echo "ERROR: git이 없습니다."; exit 1; }

# Node 18+ 확인
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "${NODE_MAJOR}" -ge 18 ] || { echo "ERROR: Node.js 18 이상이 필요합니다. 현재: $(node -v)"; exit 1; }
```

---

## Step 1. 변수 설정

```bash
APP_NAME="CC Monitor Pet"
APP_PATH="/Applications/${APP_NAME}.app"
DMG_PATH="/tmp/cc-monitor-pet.dmg"
DMG_MOUNT="/tmp/cc-monitor-pet-mount"
SRC_DIR="${SRC_DIR:-$HOME/Documents/cc-monitor-pet}"
REPO_URL="https://github.com/lilyplan/cc-monitor-pet.git"
RELEASE_API="https://api.github.com/repos/lilyplan/cc-monitor-pet/releases/latest"
PET_PORT=23333
TOKEN_PATH="$HOME/.cc-monitor-pet.token"
SETTINGS_PATH="$HOME/.claude/settings.json"
```

---

## Step 2. 최신 dmg URL 조회

GitHub Releases API에서 최신 arm64 dmg 다운로드 URL을 가져옵니다.

```bash
DMG_URL="$(curl --fail --silent --show-error "${RELEASE_API}" \
  | grep -E '"browser_download_url".*arm64\.dmg"' \
  | head -1 \
  | sed -E 's/.*"(https:[^"]+)".*/\1/')"

[ -n "${DMG_URL}" ] || { echo "ERROR: arm64 dmg URL을 찾지 못했습니다. https://github.com/lilyplan/cc-monitor-pet/releases 를 확인하세요."; exit 1; }

echo "다운로드 대상: ${DMG_URL}"
```

---

## Step 3. dmg 다운로드 + 검증

다운로드 실패 시 **즉시 중단하고 사용자에게 네트워크 또는 GitHub 접근 문제를 안내하세요.**

```bash
curl --fail --location --silent --show-error \
  "${DMG_URL}" -o "${DMG_PATH}" \
  || { echo "ERROR: dmg 다운로드 실패. 네트워크/GitHub 접근 가능 여부를 확인하세요."; exit 1; }

# 파일 존재 및 비어있지 않은지 확인
[ -s "${DMG_PATH}" ] || { echo "ERROR: 다운로드된 dmg가 비어 있습니다."; exit 1; }

# dmg 무결성 확인
hdiutil verify "${DMG_PATH}" >/dev/null 2>&1 \
  || { echo "ERROR: dmg 파일이 손상되었습니다."; rm -f "${DMG_PATH}"; exit 1; }
```

---

## Step 4. .app 설치

이미 설치된 .app이 있으면 종료 후 덮어씁니다 (재설치 안전).

```bash
# 실행 중이면 종료
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1
pkill -9 -f "${APP_NAME}" >/dev/null 2>&1 || true

# 기존 .app 삭제
[ -d "${APP_PATH}" ] && rm -rf "${APP_PATH}"

# dmg 마운트
rm -rf "${DMG_MOUNT}"
hdiutil attach -nobrowse -quiet -mountpoint "${DMG_MOUNT}" "${DMG_PATH}" \
  || { echo "ERROR: dmg 마운트 실패."; exit 1; }

# .app 복사
cp -R "${DMG_MOUNT}/${APP_NAME}.app" /Applications/ \
  || { echo "ERROR: .app 복사 실패."; hdiutil detach "${DMG_MOUNT}" >/dev/null 2>&1; exit 1; }

# dmg 언마운트 및 정리
hdiutil detach "${DMG_MOUNT}" -quiet >/dev/null 2>&1
rm -f "${DMG_PATH}"

# Gatekeeper 격리 해제 (서명 안 된 빌드라 첫 실행 막힘 방지)
xattr -dr com.apple.quarantine "${APP_PATH}" \
  || { echo "ERROR: Gatekeeper 격리 해제 실패."; exit 1; }
```

---

## Step 5. 앱 실행 + 동작 검증

```bash
open "${APP_PATH}" \
  || { echo "ERROR: .app 실행 실패."; exit 1; }

# 부팅 대기 (최대 10초)
for i in $(seq 1 10); do
  sleep 1
  pgrep -f "${APP_NAME}.app" >/dev/null && break
done

# 프로세스 살아있는지
pgrep -f "${APP_NAME}.app" >/dev/null \
  || { echo "ERROR: 앱이 실행되지 않았습니다."; exit 1; }

# 로컬 HTTP 서버 LISTEN 확인
for i in $(seq 1 10); do
  sleep 1
  lsof -i ":${PET_PORT}" -P -n -sTCP:LISTEN >/dev/null 2>&1 && break
done

lsof -i ":${PET_PORT}" -P -n -sTCP:LISTEN >/dev/null 2>&1 \
  || { echo "ERROR: 펫 서버가 127.0.0.1:${PET_PORT}에서 LISTEN하지 않습니다."; exit 1; }

# 인증 토큰 파일 생성 확인
[ -f "${TOKEN_PATH}" ] \
  || { echo "ERROR: ${TOKEN_PATH} 토큰 파일이 생성되지 않았습니다."; exit 1; }
```

---

## Step 6. 소스 clone (훅 등록용)

펫이 Claude Code 이벤트를 받으려면 훅 스크립트가 필요합니다. 소스를 어딘가에 받습니다.
이미 받아둔 폴더가 있으면 그 경로를 `SRC_DIR`로 지정하면 됩니다.

```bash
if [ ! -d "${SRC_DIR}/.git" ]; then
  git clone "${REPO_URL}" "${SRC_DIR}" \
    || { echo "ERROR: 저장소 clone 실패."; exit 1; }
else
  echo "기존 소스 폴더 재사용: ${SRC_DIR}"
fi

cd "${SRC_DIR}"
npm install --silent \
  || { echo "ERROR: npm install 실패."; exit 1; }
```

> 이 폴더는 **옮기거나 삭제하지 마세요.** Claude Code 설정이 이 경로의 `hooks/hook.js`를 절대 경로로 참조합니다.

---

## Step 7. Claude Code 훅 등록

```bash
cd "${SRC_DIR}"
npm run install-hooks \
  || { echo "ERROR: 훅 등록 실패."; exit 1; }
```

---

## Step 8. 설치 결과 검증

아래가 모두 통과해야 합니다. 하나라도 실패하면 **설치 실패로 간주하고 사용자에게 안내하세요.**

```bash
# .app 존재
[ -d "${APP_PATH}" ] \
  || { echo "ERROR: ${APP_PATH} 가 없습니다."; exit 1; }

# 펫 프로세스 + 서버 LISTEN
pgrep -f "${APP_NAME}.app" >/dev/null \
  || { echo "ERROR: 펫이 실행되어 있지 않습니다."; exit 1; }
lsof -i ":${PET_PORT}" -P -n -sTCP:LISTEN >/dev/null 2>&1 \
  || { echo "ERROR: 펫 서버가 LISTEN하지 않습니다."; exit 1; }

# 토큰 파일 권한 0600
[ -f "${TOKEN_PATH}" ] \
  || { echo "ERROR: ${TOKEN_PATH} 가 없습니다."; exit 1; }

# Claude Code settings.json 에 훅 등록
[ -f "${SETTINGS_PATH}" ] \
  || { echo "ERROR: ${SETTINGS_PATH} 가 없습니다 (Claude Code 미설치?)."; exit 1; }

grep -q "cc-monitor-pet" "${SETTINGS_PATH}" \
  || { echo "ERROR: settings.json에 cc-monitor-pet 훅이 등록되지 않았습니다."; exit 1; }

grep -q "127.0.0.1:${PET_PORT}/permission" "${SETTINGS_PATH}" \
  || { echo "ERROR: PermissionRequest HTTP hook이 등록되지 않았습니다."; exit 1; }

echo "설치 완료: cc-monitor-pet"
echo "Claude Code를 새로 실행하면 펫이 이벤트에 반응합니다."
```

---

## 설치 완료 후

설치 성공이 곧 **자동 실행 / MCP 연동 활성화를 의미하지 않습니다.** 필요에 따라 다음 설정을 추가하세요.

**로그인 시 자동 실행 (선택)**

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/CC Monitor Pet.app", hidden:true}'
```

**MCP 서버 연결 (선택)**

`~/.claude.json` 의 `mcpServers`에 다음을 추가하면 Claude가 `signal_pet` 도구로 펫 상태를 직접 제어할 수 있습니다. `SRC_DIR` 경로는 Step 6에서 사용한 실제 경로로 바꿔주세요.

```json
{
  "mcpServers": {
    "cc-monitor-pet": {
      "command": "node",
      "args": ["/Users/YOUR_NAME/Documents/cc-monitor-pet/mcp/pet-server.js"]
    }
  }
}
```

설정 후 Claude를 재시작해야 적용됩니다.

---

## 트러블슈팅

| 증상 | 확인 |
|---|---|
| 권한 팝업 클릭해도 Claude Code가 멈춰 있음 | `~/Library/Logs/cc-monitor-pet/debug.log` 마지막 부분 — `[server] permission → allow` 라인이 보이면 응답은 정상 |
| 펫이 보이지 않음 | `~/Library/Application Support/cc-monitor-pet/settings.json` 삭제 후 펫 재시작 (창 위치 리셋) |
| Gatekeeper 경고로 실행 안 됨 | Step 4의 `xattr -dr com.apple.quarantine` 재실행 또는 우클릭 → 열기 |
| 펫이 Claude Code에 반응 안 함 | Step 7 재실행 후 Claude Code 재시작 |
