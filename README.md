# CC Desk Pet 🦀

Claude Code의 AI 에이전트 활동을 시각화하는 macOS 데스크탑 펫.  
Claude Code가 작업 중일 때 화면 위에 픽셀아트 캐릭터가 반응합니다.

## 기능

| 상태 | 트리거 |
|------|--------|
| 대기 (idle) | 기본 상태. 마우스를 따라 눈이 움직임 |
| 타이핑 (working) | 프롬프트 입력 / 도구 실행 중 |
| 저글링 (juggling) | 서브에이전트 실행 중 |
| 오류 (error) | 도구 실행 실패 |
| 알림 (notification) | 클로드 알림 이벤트 |
| 기쁨 (attention) | 컨텍스트 압축 완료 |
| 청소 (sweeping) | 컨텍스트 압축 중 |
| 수면 | 5분 이상 비활성 시 자동 전환 |

- 항상 최상위 레이어에 표시 (모든 공간 표시)
- 창 위치 저장 (재시작 시 복원)
- 우클릭 → 종료 메뉴

## 설치 및 실행

**요구사항:** Node.js 18+, macOS

```bash
git clone https://github.com/YOUR_USERNAME/cc-desk-pet.git
cd cc-desk-pet
npm install
npm start
```

## Claude Code 훅 연결

앱 실행 후 아래 명령어로 Claude Code 훅을 등록합니다.

```bash
npm run install-hooks
```

`~/.claude/settings.json`에 13개 이벤트 훅이 등록됩니다.  
이후 Claude Code 사용 시 자동으로 캐릭터가 반응합니다.

## 훅 제거

```bash
# settings.json 에서 cc-desk-pet 관련 훅을 직접 삭제하거나
# 백업 파일로 복원
cp ~/.claude/settings.json.bak ~/.claude/settings.json
```

## 구조

```
cc-desk-pet/
├── src/
│   ├── main.js          # Electron 메인 프로세스
│   ├── preload.cjs      # contextBridge (SVG 로딩, IPC)
│   ├── renderer.js      # 상태 머신 + 스프라이트 렌더링
│   ├── server.js        # 로컬 HTTP 서버 (127.0.0.1:23333)
│   ├── prefs.js         # 창 위치 저장
│   └── index.html
├── assets/themes/cc/sprites/   # 픽셀아트 SVG 스프라이트 (15종)
└── hooks/
    ├── hook.js          # Claude Code 훅 스크립트
    └── install.js       # 훅 설치기
```

## 보안

- 외부 네트워크 통신 없음
- 모든 이벤트는 `127.0.0.1:23333` 로컬 전용
- Claude Code 훅은 stdin JSON → 로컬 POST 전달만 수행

## License

MIT
