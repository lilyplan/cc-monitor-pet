/**
 * Pet state machine.
 *
 * Each state is described in one place (STATE_CONFIG). The machine keeps a
 * stack of active "sustained" states; the highest-priority one wins. One-shot
 * states (error, done, cheering, ...) auto-return after their duration.
 *
 * Public API: `createStateMachine({ onEnter })` returns:
 *   - request(state)   : higher priority preempts; equal-priority is ignored
 *                        (special case: juggling preempts carrying)
 *   - release(state)   : drop a sustained state, recompute current
 *   - reset()          : drop all sustained states, go to idle
 *   - getState()       : current state
 */

const IDLE = 'idle'
const SLEEP_SEQUENCE = ['yawning', 'dozing', 'collapsing', 'sleeping']

/**
 * priority : higher beats lower
 * oneShot  : ms to hold then auto-return (omit for sustained)
 * sprite   : explicit sprite key (defaults to state name)
 */
export const STATE_CONFIG = {
  sleeping:     { priority: 0 },
  idle:         { priority: 1 },
  thinking:     { priority: 2, sprite: 'working' },
  working:      { priority: 3 },
  cheering:     { priority: 3, oneShot: 3000 },
  carrying:     { priority: 4 },
  juggling:     { priority: 4 },
  attention:    { priority: 5, oneShot: 3000 },
  sweeping:     { priority: 6, oneShot: 60000 },
  done:         { priority: 6, oneShot: 8000 },
  notification: { priority: 7, oneShot: 13000 },
  error:        { priority: 8, oneShot: 3000 },
}

const SLEEP_STATES = new Set([...SLEEP_SEQUENCE])

const IDLE_TIMEOUT_MS = 5 * 60_000

function priorityOf(state) {
  return STATE_CONFIG[state]?.priority ?? 0
}

function isOneShot(state) {
  return typeof STATE_CONFIG[state]?.oneShot === 'number'
}

export function spriteFor(state) {
  return STATE_CONFIG[state]?.sprite ?? state
}

export function createStateMachine({ onEnter }) {
  const sustained = new Map()   // state -> ref count
  let current = IDLE
  let sleepTimer = null
  let oneShotTimer = null
  let sleepStepTimer = null     // tracks chained setTimeout in sleep sequence

  function emit(state, { wakingFrom } = {}) {
    if (current === state && !wakingFrom) return
    current = state
    onEnter(state, { wakingFrom })
  }

  function resolveActive() {
    let best = IDLE
    let bestP = priorityOf(IDLE)
    for (const s of sustained.keys()) {
      const p = priorityOf(s)
      if (p > bestP || (p === bestP && s === 'juggling')) {
        best = s
        bestP = p
      }
    }
    return best
  }

  function clearSleepStep() {
    if (sleepStepTimer) { clearTimeout(sleepStepTimer); sleepStepTimer = null }
  }

  function scheduleSleep() {
    if (sleepTimer) clearTimeout(sleepTimer)
    sleepTimer = setTimeout(() => {
      if (current === IDLE) startSleepSequence()
    }, IDLE_TIMEOUT_MS)
  }

  function startSleepSequence() {
    let i = 0
    const step = () => {
      const frame = SLEEP_SEQUENCE[i]
      // bypass current-state check: this is a visual sub-sequence within "sleeping"
      onEnter(frame, { sleepFrame: true })
      i++
      if (i < SLEEP_SEQUENCE.length) sleepStepTimer = setTimeout(step, 1400)
      else sleepStepTimer = null
    }
    current = 'sleeping'
    step()
  }

  function transitionTo(next) {
    clearSleepStep()
    if (oneShotTimer) { clearTimeout(oneShotTimer); oneShotTimer = null }

    const wakingFrom = SLEEP_STATES.has(current) || current === 'sleeping' ? current : null
    emit(next, { wakingFrom })

    const cfg = STATE_CONFIG[next]
    if (cfg?.oneShot) {
      oneShotTimer = setTimeout(() => {
        if (!isOneShot(current)) return
        if (next === 'cheering') {
          // cheering finished but other sustained states may still be active
          transitionTo(resolveActive())
        } else {
          sustained.clear()
          transitionTo(IDLE)
        }
      }, cfg.oneShot)
    }

    if (next === IDLE) scheduleSleep()
  }

  function request(state) {
    if (!(state in STATE_CONFIG)) return
    if (!isOneShot(state)) sustained.set(state, (sustained.get(state) ?? 0) + 1)

    const rp = priorityOf(state)
    const cp = priorityOf(current)
    if (rp > cp) {
      transitionTo(state)
    } else if (rp === cp && state === 'juggling' && current === 'carrying') {
      transitionTo(state)
    }
  }

  function release(state) {
    const n = sustained.get(state) ?? 0
    if (n <= 1) sustained.delete(state)
    else sustained.set(state, n - 1)
    if (current === state) transitionTo(resolveActive())
  }

  function reset() {
    sustained.clear()
    transitionTo(IDLE)
  }

  function getState() { return current }

  // Boot: idle + sleep watchdog
  transitionTo(IDLE)

  return { request, release, reset, getState }
}
