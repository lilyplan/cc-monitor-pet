# CC Monitor Pet 🔔

Claude Code의 AI 에이전트 활동을 시각화하는 macOS 데스크탑 펫.  
Claude Code가 작업할 때 화면 위 픽셀아트 캐릭터가 실시간으로 반응합니다.

<img src="assets/themes/cc/sprites/idle.svg" width="90"> <img src="assets/themes/cc/sprites/working.svg" width="90"> <img src="assets/themes/cc/sprites/notification.svg" width="90"> <img src="assets/themes/cc/sprites/sleeping.svg" width="90">

## 화면 예시

캐릭터는 기본적으로 **화면 좌측 하단**에 떠 있습니다.  
모든 앱 위에 항상 표시됩니다.

```
┌─────────────────────────────────────────────────┐
│  ●  macOS Desktop                               │
│                                                  │
│   ┌──────────────────────────┐                  │
│   │                          │                  │
│   │   Claude Code (터미널)    │                  │
│   │                          │                  │
│   │  > 파일 분석 중...        │                  │
│   │                          │                  │
│   └──────────────────────────┘                  │
│                                                  │
│  ┌──────┐                                        │
│  │  🎁  │  ← CC Monitor Pet                      │
│  │      │     (112×112, 항상 최상위)              │
└──┴──────┴────────────────────────────────────────┘
```

> 위치는 앱 종료 후 재시작해도 유지됩니다.

## 기능

### Permission Bubble

도구 실행 권한 요청 시 터미널 대신 캐릭터 머리 위에 팝업 카드가 표시됩니다.

```
┌─────────────────────┐
│  🔐 Bash            │  ← 실제 도구 이름 표시
│ [거부] [허용] [항상허용] │
└─────────────────────┘
       ↑ 5px
    ┌──────┐
    │  ☁️  │  ← CC Monitor Pet
    └──────┘
```

| 버튼 | 동작 |
|------|------|
| 거부 | `behavior: deny` 응답 → CC가 도구 실행 취소 |
| 허용 | `behavior: allow` 응답 → 이번 한 번만 |
| 항상 허용 | `behavior: allow` + `updatedPermissions` 응답 → CC가 `~/.claude/settings.json`에 규칙 저장 |

> Claude Code 2.1+의 **네이티브 PermissionRequest HTTP hook**을 사용합니다.  
> CC가 `POST /permission`으로 보낸 요청을 long-poll로 잡고, 사용자 결정을 응답 본문으로 돌려줍니다.  
> 응답 본문 스키마는 [`src/server.js`](src/server.js) 참고:
> ```json
> {
>   "hookSpecificOutput": {
>     "hookEventName": "PermissionRequest",
>     "decision": { "behavior": "allow" }
>   }
> }
> ```
> "항상 허용" 결정은 CC가 직접 `~/.claude/settings.json`에 규칙을 저장하므로 펫이 별도로 관리하지 않습니다.

### 상태 머신

우선순위에 따라 가장 중요한 상태를 표시합니다.

| 우선순위 | 상태 | 트리거 | 설명 |
|:--------:|------|--------|------|
| 8 | 오류 | 도구 실행 실패 | 3초 후 자동 복귀 |
| 7 | 알림 🔔 | 응답 완료 / 권한 대기 감지 | 13초 후 idle 복귀 |
| 6 | 청소 | 컨텍스트 압축 중 | 3초 후 자동 복귀 |
| 5 | 기쁨 | 컨텍스트 압축 완료 | 3초 후 자동 복귀 |
| 4 | 폭풍 구름 | 서브에이전트 병렬 실행 중 | — |
| 4 | 운반 | (carrying 상태) | — |
| 3 | 타이핑 | 프롬프트 입력 / 도구 실행 중 | — |
| 2 | 생각 중 | thinking 상태 | — |
| 1 | 대기 | 기본 상태 | 마우스를 따라 눈이 움직임 |
| 0 | 수면 | 5분 이상 비활성 | yawning → dozing → collapsing → sleeping |

### 권한 대기 감지

도구 실행 후 2초 내 완료 응답이 없으면 "허용하시겠습니까?" 대기 상태로 판단, 알림 캐릭터가 점프하여 주의를 끕니다.

### 인터랙션

| 동작 | 결과 |
|------|------|
| 좌클릭 | Claude 앱 실행 (없으면 claude.ai 브라우저로 열기) |
| 우클릭 | 종료 메뉴 |

### 기타

- 항상 최상위 레이어 표시 (전체 화면에서도 보임)
- 창 위치 저장 및 재시작 시 복원
- idle 상태에서 마우스 방향으로 눈 트래킹

## 다운로드 & 설치

**요구사항:** macOS (Apple Silicon — M1/M2/M3/M4), Node.js 18+ (훅 등록 시에만 필요)

### 방법 1 · DMG 다운로드 (권장)

1. [Releases 페이지](https://github.com/lilyplan/cc-monitor-pet/releases/latest)에서 **`CC Monitor Pet-0.1.0-arm64.dmg`** 다운로드
2. dmg 더블클릭 → `CC Monitor Pet.app`을 `Applications` 폴더로 드래그
3. **Gatekeeper 우회 (서명 안 된 앱이라 첫 실행만 필요):**
   ```bash
   xattr -dr com.apple.quarantine "/Applications/CC Monitor Pet.app"
   ```
   또는 `Applications`의 `CC Monitor Pet.app`을 **우클릭 → 열기 → 열기**로 첫 실행 (시스템 설정 → 개인 정보 및 보안에서 "확인되지 않은 개발자" 허용 클릭도 가능)
4. `Applications` 폴더에서 더블클릭으로 실행 → 화면 좌측 하단에 펫 등장

### 방법 2 · 소스에서 빌드 (개발자용)

```bash
git clone https://github.com/lilyplan/cc-monitor-pet.git
cd cc-monitor-pet
npm install
npm start                # 개발 모드로 바로 실행
# 또는
npm run build:mac        # dist/ 에 dmg + .app 생성
```

## Claude Code 훅 연결 (필수)

펫이 CC 이벤트(권한 요청, 도구 실행, 컨텍스트 압축 등)에 반응하려면 한 번만 훅을 등록해야 합니다.

```bash
# 1. 저장소를 어딘가에 clone (이미 했다면 스킵)
git clone https://github.com/lilyplan/cc-monitor-pet.git ~/Documents/cc-monitor-pet

# 2. 훅 등록
cd ~/Documents/cc-monitor-pet
npm install
npm run install-hooks
```

`~/.claude/settings.json`에 13개 이벤트 훅과 PermissionRequest HTTP hook이 자동 등록됩니다.
이후 Claude Code 사용 시 캐릭터가 자동으로 반응하고, 권한 요청은 펫 머리 위 팝업으로 뜹니다.

> 기존 `settings.json`은 `.bak` 파일로 백업됩니다.
> 훅 스크립트(`hooks/hook.js`)는 clone한 폴더에서 절대 경로로 참조되므로, 이 폴더는 옮기거나 삭제하지 마세요.

## 로그인 시 자동 실행 (macOS)

Mac을 켤 때 펫이 자동으로 실행되도록 설정합니다.

**방법 A · 시스템 설정에서 (가장 간단)**

`시스템 설정 → 일반 → 로그인 항목`에서 `+`를 누르고 `/Applications/CC Monitor Pet.app`을 추가합니다.

**방법 B · 터미널에서**

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/CC Monitor Pet.app", hidden:true}'
```

**자동 실행 해제**

```bash
osascript -e 'tell application "System Events" to delete login item "CC Monitor Pet"'
```

## MCP 서버 연결 (선택)

Claude Desktop 또는 Claude Code에서 MCP를 통해 직접 펫 상태를 제어할 수 있습니다.

**Claude Code (`~/.claude.json`)**

```json
{
  "mcpServers": {
    "cc-monitor-pet": {
      "command": "node",
      "args": ["/절대경로/cc-monitor-pet/mcp/pet-server.js"]
    }
  }
}
```

**Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)**

```json
{
  "mcpServers": {
    "cc-monitor-pet": {
      "command": "node",
      "args": ["/절대경로/cc-monitor-pet/mcp/pet-server.js"]
    }
  }
}
```

> `/절대경로/cc-monitor-pet`을 실제 경로로 변경하세요. (예: `/Users/yourname/Desktop/cc-monitor-pet`)  
> 설정 후 앱을 재시작하면 `signal_pet` 도구가 활성화됩니다.

MCP가 연결되면 Claude가 작업 시작/완료/오류 시점에 직접 펫 상태를 변경할 수 있습니다.

## 훅 제거

```bash
# 백업 파일로 복원
cp ~/.claude/settings.json.bak ~/.claude/settings.json
```

## 구조

```
cc-monitor-pet/
├── src/
│   ├── main.js               # Electron 메인 프로세스, 창 관리
│   ├── preload.cjs           # contextBridge (SVG 로딩, IPC)
│   ├── renderer.js           # 스프라이트 렌더링 (DOM 채널 전환)
│   ├── state-machine.js      # 우선순위 상태 머신 + sleep 시퀀스
│   ├── server.js             # 로컬 HTTP 서버 (/state, /permission, 토큰 인증)
│   ├── prefs.js              # 창 위치 저장
│   ├── permission-window.js  # Permission Bubble 창 컨트롤러
│   ├── permission.html       # Permission Bubble UI
│   ├── permission.js         # Permission Bubble 렌더러
│   ├── permission-preload.cjs  # Permission Bubble IPC 브릿지
│   ├── index.html
│   └── lib/
│       ├── constants.js      # PET_SIZE / SERVER_PORT / TOKEN_PATH 등
│       ├── pet-client.js     # hook.js + mcp 공통 HTTP 클라이언트
│       └── logger.js         # 메인 콘솔 → debug.log 미러링
├── assets/themes/cc/sprites/   # SVG 스프라이트
├── build/
│   ├── icon.svg / .png / .icns   # 앱 아이콘
│   └── render-icon.cjs       # SVG → 알파 PNG 렌더 스크립트 (Electron)
├── hooks/
│   ├── hook.js          # Claude Code 훅 스크립트 (stdin → POST /state)
│   └── install.js       # 훅 설치기 (Node.js 절대 경로 자동 감지)
└── mcp/
    └── pet-server.js    # MCP 서버 (signal_pet 도구 제공)
```

## 트러블슈팅

빌드된 `.app`은 stdout이 보이지 않으므로 메인 프로세스 콘솔 출력을 파일에 미러링합니다.

**디버그 로그 위치**

```
~/Library/Logs/cc-monitor-pet/debug.log
```

- 앱이 시작될 때마다 truncate (가장 최근 세션만 보존)
- 모든 `console.log/warn/error`가 timestamp + level과 함께 기록
- 팝업 윈도우(renderer)의 콘솔도 `perm:log` IPC를 통해 메인으로 forward되어 같은 파일에 기록

**팝업 자체의 DevTools를 같이 보고 싶을 때**

[`src/permission-window.js`](src/permission-window.js)의 `DEBUG_DEVTOOLS = false`를 `true`로 바꾸고 재빌드하면, 권한 팝업이 뜰 때마다 DevTools가 자동으로 함께 열립니다.

## 보안

- **외부 네트워크 통신 없음** 
- **토큰 인증** — 앱 시작 시 랜덤 토큰 생성(`~/.cc-monitor-pet.token`, 0600), 토큰 불일치 시 403 반환
- **바디 크기 제한** — 요청 64KB 초과 시 413 반환
- `contextIsolation: true`로 렌더러와 Node.js 환경 분리

## Credits

[rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 프로젝트에서 아이디어를 얻어 새로 제작했습니다.

## Disclaimer

The Claude character is the property of Anthropic. This is an unofficial fan project and is not affiliated with, endorsed by, or approved by Anthropic.

The artwork in `assets/` is **not** covered by the MIT License. All rights belong to their respective copyright holders. See `assets/LICENSE` for details.

Third-party content: copyright belongs to the respective artists.

## License

The source code in this repository is licensed under the MIT License.  
The artwork in `assets/` is excluded from this license. See the Disclaimer above.
