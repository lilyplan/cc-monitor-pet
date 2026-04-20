/**
 * CC Desk Pet — 렌더러 v2
 * - 파일 기반 SVG 스프라이트 (fetch)
 * - 듀얼 채널: object(아이 트래킹) / div(일반 상태)
 * - 우선순위 상태 머신 인라인
 */

;(async function init() {

  // ── 상태 머신 ─────────────────────────────────────────────────

  const PRIORITY = {
    sleeping: 0, idle: 1, thinking: 2, working: 3,
    carrying: 4, juggling: 4,
    attention: 5, sweeping: 6, notification: 7, error: 8,
  }
  const ONE_SHOT   = new Set(['error', 'notification', 'attention', 'sweeping'])
  const SLEEP_SET  = new Set(['sleeping', 'yawning', 'dozing', 'collapsing'])

  let currentState = 'idle'
  let activeStates = {}
  let idleTimer = null, sleepTimer = null, wakeTimer = null, oneShotTimer = null

  function requestState(state) {
    if (!(state in PRIORITY)) return
    resetIdleTimers()
    if (!ONE_SHOT.has(state)) activeStates[state] = (activeStates[state] ?? 0) + 1

    const rp = PRIORITY[state], cp = PRIORITY[currentState] ?? 0
    if (rp === cp) {
      if (state === 'juggling' && currentState === 'carrying') doTransition(state)
      return
    }
    if (rp > cp) doTransition(state, SLEEP_SET.has(currentState))
  }

  function releaseState(state) {
    if (!activeStates[state]) return
    activeStates[state]--
    if (activeStates[state] <= 0) delete activeStates[state]
    if (currentState === state) doTransition(resolveActive())
  }

  function resolveActive() {
    let best = 'idle', bestP = PRIORITY['idle']
    for (const s of Object.keys(activeStates)) {
      const p = PRIORITY[s]
      if (p > bestP || (p === bestP && s === 'juggling')) { best = s; bestP = p }
    }
    return best
  }

  function doTransition(to, wakeNeeded = false) {
    if (currentState === to) return
    console.log(`[state] ${currentState} → ${to}${wakeNeeded ? ' (wake)' : ''}`)
    currentState = to
    if (wakeNeeded)        { playSleepInterrupt(to) }
    else if (to === 'sleeping') { playSleepSequence() }
    else                   { setSprite(to) }
  }

  function resetIdleTimers() {
    clearTimeout(idleTimer); clearTimeout(sleepTimer)
    idleTimer  = setTimeout(() => { if (currentState === 'idle') console.log('[state] idle:random') }, 20_000)
    sleepTimer = setTimeout(() => { if (currentState === 'idle') doTransition('sleeping') }, 5 * 60_000)
  }

  // ── 스프라이트 로딩 ──────────────────────────────────────────

  const SPRITE_NAMES = [
    'idle', 'idle-follow', 'thinking', 'working', 'juggling',
    'carrying', 'error', 'notification', 'attention', 'sweeping',
    'yawning', 'dozing', 'collapsing', 'sleeping', 'waking',
  ]
  const SPRITES = {}

  // fetch 대신 preload의 Node.js fs로 읽기 (file:// CORS 우회)
  for (const name of SPRITE_NAMES) {
    const svg = window.pet.readSprite(name)
    if (svg) SPRITES[name] = svg
    else console.warn(`[renderer] 스프라이트 로드 실패: ${name}`)
  }

  console.log(`[renderer] 스프라이트 로드 완료: ${Object.keys(SPRITES).length}/${SPRITE_NAMES.length}`)

  // <object> 태그용 절대 경로 (idle-follow.svg 아이 트래킹)
  const SPRITE_DIR = window.pet.getSpriteDir()
  const FOLLOW_PATH = `file://${SPRITE_DIR}/idle-follow.svg`

  // ── DOM 요소 ─────────────────────────────────────────────────

  const followObj = document.getElementById('ch-follow')
  const spriteDiv = document.getElementById('ch-sprite')

  // ── 아이 트래킹 ──────────────────────────────────────────────

  let svgDoc      = null
  let eyeTracking = false

  // idle-follow.svg 에 맞춘 좌표 (눈 r=14, 동공 r=8)
  const EYE_DEFAULT = { left: { cx: 44, cy: 58 }, right: { cx: 76, cy: 58 } }
  const MAX_OFFSET  = 4

  followObj.addEventListener('load', () => {
    try {
      svgDoc = followObj.contentDocument
      eyeTracking = true
      console.log('[renderer] 아이 트래킹 SVG 로드 완료')
    } catch (e) {
      console.warn('[renderer] SVG DOM 접근 실패', e)
    }
  })

  window.addEventListener('mousemove', e => {
    if (!eyeTracking || !svgDoc || currentState !== 'idle') return

    const cx = window.innerWidth  / 2
    const cy = window.innerHeight / 2
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / cx))
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / cy))
    const ox = dx * MAX_OFFSET
    const oy = dy * MAX_OFFSET

    const pl = svgDoc.getElementById('pupil-left')
    const pr = svgDoc.getElementById('pupil-right')
    const sl = svgDoc.getElementById('shine-left')
    const sr = svgDoc.getElementById('shine-right')

    if (pl) { pl.setAttribute('cx', EYE_DEFAULT.left.cx  + ox); pl.setAttribute('cy', EYE_DEFAULT.left.cy  + oy) }
    if (pr) { pr.setAttribute('cx', EYE_DEFAULT.right.cx + ox); pr.setAttribute('cy', EYE_DEFAULT.right.cy + oy) }
    // shine은 살짝 더 작은 오프셋 (idle-follow.svg 기준: shine-left cx=58, cy=56)
    if (sl) { sl.setAttribute('cx', 47 + ox * 0.6); sl.setAttribute('cy', 55 + oy * 0.6) }
    if (sr) { sr.setAttribute('cx', 79 + ox * 0.6); sr.setAttribute('cy', 55 + oy * 0.6) }
  })

  // ── 채널 전환 ────────────────────────────────────────────────

  function showFollow() {
    followObj.style.display = 'block'
    spriteDiv.style.display = 'none'
    // 절대 경로로 설정 (file:// 프로토콜, 상대 경로 문제 없음)
    if (followObj.getAttribute('data') !== FOLLOW_PATH) {
      svgDoc = null
      eyeTracking = false
      followObj.setAttribute('data', FOLLOW_PATH)
    }
    eyeTracking = !!svgDoc
  }

  function showSprite(svgText) {
    followObj.style.display = 'none'
    spriteDiv.style.display = 'flex'
    eyeTracking = false
    spriteDiv.innerHTML = svgText ?? ''
  }

  // ── 스프라이트 설정 ──────────────────────────────────────────

  function setSprite(state) {
    clearTimeout(oneShotTimer)

    if (state === 'idle') {
      showFollow()
      return
    }

    const svg = SPRITES[state] ?? SPRITES['idle']
    showSprite(svg)
    console.log(`[renderer] sprite → ${state}`)

    // ONE_SHOT 상태는 3초 후 자동으로 idle 복귀
    if (ONE_SHOT.has(state)) {
      oneShotTimer = setTimeout(() => {
        if (ONE_SHOT.has(currentState)) {
          activeStates = {}
          doTransition('idle')
          resetIdleTimers()
        }
      }, 3000)
    }
  }

  // ── 수면 시퀀스 ──────────────────────────────────────────────

  const SLEEP_SEQ = ['yawning', 'dozing', 'collapsing', 'sleeping']

  function playSleepSequence() {
    let i = 0
    function step() {
      setSprite(SLEEP_SEQ[i])
      i++
      if (i < SLEEP_SEQ.length) setTimeout(step, 1400)
    }
    step()
  }

  function playSleepInterrupt(targetState) {
    clearTimeout(wakeTimer)
    setSprite('waking')
    wakeTimer = setTimeout(() => setSprite(targetState), 700)
  }

  // ── IPC 이벤트 수신 ─────────────────────────────────────────

  if (window.pet) {
    window.pet.onStateChanged(({ state, event }) => {
      console.log(`[renderer] event=${event} → state=${state}`)
      if (event === 'SessionEnd') {
        // 세션 종료 → 즉시 idle
        activeStates = {}
        doTransition('idle')
        resetIdleTimers()
      } else {
        requestState(state)
      }
    })
  } else {
    console.warn('[renderer] window.pet 없음 — preload 미연결')
  }

  // ── 우클릭 컨텍스트 메뉴 (hit-area 전체 감지) ───────────────

  document.getElementById('hit-area').addEventListener('contextmenu', e => {
    e.preventDefault()
    window.pet?.showContextMenu()
  })
  // hit-area가 드래그를 막으므로, 좌클릭 드래그는 별도 IPC 없이 Electron이 처리
  // (추후 드래그 기능 추가 시 mousedown → ipcRenderer.send('start-drag') 방식 사용)

  // ── 초기화 ──────────────────────────────────────────────────

  resetIdleTimers()
  setSprite('idle')

})()
