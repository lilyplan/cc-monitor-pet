# CC Monitor Pet — Agent Instructions

## 펫 신호 규칙 (필수)

`cc-monitor-pet` MCP 서버의 `signal_pet` 도구를 아래 타이밍에 반드시 호출하세요.

| 타이밍 | state | 설명 |
|---|---|---|
| 작업 시작 시 | `working` | 도구 사용 전, 코드 작성 전 |
| 복잡한 분석/판단 중 | `thinking` | 계획 수립, 코드 분석 |
| 병렬 작업 중 | `juggling` | 여러 파일/태스크 동시 처리 |
| 오류 발생 시 | `error` | 실패, 예외 상황 |
| 작업 완료 시 | `done` | 태스크 완료, 결과 전달 |
| 대기/종료 시 | `idle` | 응답 완료 후 |

### 예시
```
작업 시작 → signal_pet(state="working")
...작업 수행...
완료 → signal_pet(state="done")
```

오류 없이 빠르게 호출하고, 펫 서버가 꺼져 있어도 무시하고 계속 진행하세요.
