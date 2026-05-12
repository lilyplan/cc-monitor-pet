/**
 * CC Desk Pet — renderer.
 * Responsibilities:
 *   - Load SVG sprites via preload bridge.
 *   - Run the state machine (see state-machine.js).
 *   - Render the currently active state into one of two channels
 *     (idle eye-tracking <object> / generic SVG <div>).
 *   - Handle pet interactions (drag, click, context menu).
 */

import { createStateMachine, spriteFor } from './state-machine.js'

;(function init() {

  // ── Sprite loading ─────────────────────────────────────────
  const SPRITE_NAMES = [
    'idle', 'idle-follow', 'thinking', 'working', 'juggling',
    'carrying', 'cheering', 'done', 'error', 'notification', 'attention', 'sweeping',
    'yawning', 'dozing', 'collapsing', 'sleeping', 'waking',
  ]
  const SPRITES = {}
  for (const name of SPRITE_NAMES) {
    const svg = window.pet.readSprite(name)
    if (svg) SPRITES[name] = svg
    else console.warn(`[renderer] 스프라이트 로드 실패: ${name}`)
  }
  console.log(`[renderer] 스프라이트 로드 완료: ${Object.keys(SPRITES).length}/${SPRITE_NAMES.length}`)

  const SPRITE_DIR = window.pet.getSpriteDir()
  const FOLLOW_PATH = `file://${SPRITE_DIR}/idle-follow.svg`

  // ── DOM ────────────────────────────────────────────────────
  const followObj = document.getElementById('ch-follow')
  const spriteDiv = document.getElementById('ch-sprite')
  const hitArea = document.getElementById('hit-area')

  // ── Eye tracking ───────────────────────────────────────────
  const EYE = {
    left:  { cx: 44, cy: 58, shineX: 47, shineY: 55 },
    right: { cx: 76, cy: 58, shineX: 79, shineY: 55 },
  }
  const MAX_OFFSET = 4
  let svgDoc = null
  let eyeTracking = false

  followObj.addEventListener('load', () => {
    try {
      svgDoc = followObj.contentDocument
      eyeTracking = true
    } catch (e) {
      console.warn('[renderer] SVG DOM 접근 실패', e)
    }
  })

  window.addEventListener('mousemove', e => {
    if (!eyeTracking || !svgDoc || machine.getState() !== 'idle') return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / cx))
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / cy))
    const ox = dx * MAX_OFFSET
    const oy = dy * MAX_OFFSET

    const set = (id, x, y) => {
      const el = svgDoc.getElementById(id)
      if (el) { el.setAttribute('cx', x); el.setAttribute('cy', y) }
    }
    set('pupil-left',  EYE.left.cx + ox,  EYE.left.cy + oy)
    set('pupil-right', EYE.right.cx + ox, EYE.right.cy + oy)
    set('shine-left',  EYE.left.shineX  + ox * 0.6, EYE.left.shineY  + oy * 0.6)
    set('shine-right', EYE.right.shineX + ox * 0.6, EYE.right.shineY + oy * 0.6)
  })

  // ── Channel switching ──────────────────────────────────────
  const FADE_MS = 150
  const WAKE_HOLD_MS = 700
  let wakeTimer = null

  function showFollow() {
    const active = followObj.style.display !== 'none' ? followObj : spriteDiv
    active.style.opacity = '0'
    setTimeout(() => {
      spriteDiv.style.display = 'none'
      followObj.style.display = 'block'
      followObj.style.opacity = '0'
      if (followObj.getAttribute('data') !== FOLLOW_PATH) {
        svgDoc = null
        eyeTracking = false
        followObj.setAttribute('data', FOLLOW_PATH)
      }
      eyeTracking = !!svgDoc
      requestAnimationFrame(() => { followObj.style.opacity = '1' })
    }, FADE_MS)
  }

  function showSprite(svgText) {
    const active = spriteDiv.style.display !== 'none' ? spriteDiv : followObj
    active.style.opacity = '0'
    setTimeout(() => {
      followObj.style.display = 'none'
      spriteDiv.style.display = 'flex'
      spriteDiv.style.opacity = '0'
      eyeTracking = false
      spriteDiv.innerHTML = svgText ?? ''
      requestAnimationFrame(() => { spriteDiv.style.opacity = '1' })
    }, FADE_MS)
  }

  function paint(state) {
    if (state === 'idle') { showFollow(); return }
    const sprite = spriteFor(state)
    showSprite(SPRITES[sprite] ?? SPRITES.idle)
  }

  // ── State machine wiring ───────────────────────────────────
  const machine = createStateMachine({
    onEnter(state, { wakingFrom } = {}) {
      console.log(`[renderer] → ${state}${wakingFrom ? ` (wake from ${wakingFrom})` : ''}`)
      if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null }
      if (wakingFrom) {
        showSprite(SPRITES.waking ?? SPRITES.idle)
        wakeTimer = setTimeout(() => paint(state), WAKE_HOLD_MS)
      } else {
        paint(state)
      }
    },
  })

  // ── IPC ────────────────────────────────────────────────────
  if (window.pet) {
    window.pet.onStateChanged(({ state, event }) => {
      console.log(`[renderer] event=${event} → state=${state}`)
      if (event === 'SessionEnd') machine.reset()
      else machine.request(state)
    })
  } else {
    console.warn('[renderer] window.pet 없음 — preload 미연결')
  }

  // ── Interactions ───────────────────────────────────────────
  let dragging = false

  hitArea.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    dragging = true
    window.pet?.dragStart(e.screenX, e.screenY)
    e.preventDefault()
  })

  window.addEventListener('mousemove', e => {
    if (!dragging) return
    window.pet?.dragMove(e.screenX, e.screenY)
  })

  window.addEventListener('mouseup', e => {
    if (e.button !== 0 || !dragging) return
    dragging = false
    window.pet?.dragEnd()
  })

  hitArea.addEventListener('contextmenu', e => {
    e.preventDefault()
    window.pet?.showContextMenu()
  })

  hitArea.addEventListener('click', e => {
    if (e.detail === 0) return   // drag-end synthesises a click with detail=0
    e.preventDefault()
    window.pet?.openClaude()
  })
})()
