// Permission popup renderer.
// Every diagnostic line goes to (a) DevTools console and (b) main-process
// log file via `window.perm.log` → IPC `perm:log` → main → debug.log.

const log  = (...a) => { console.log(...a);  window.perm?.log?.(...a) }
const warn = (...a) => { console.warn(...a); window.perm?.warn?.(...a) }
const err  = (...a) => { console.error(...a); window.perm?.err?.(...a) }

log('[perm] permission.js loaded — window.perm =', typeof window.perm)

let currentData = {}

if (!window.perm) {
  err('[perm] window.perm 미정의! preload(permission-preload.cjs) 로드 실패 추정')
} else {
  window.perm.onData((data) => {
    currentData = data
    log('[perm] perm:data 수신', data)

    const titleEl = document.getElementById('title')
    if (!titleEl) { err('[perm] #title 미발견'); return }
    titleEl.textContent = data.toolName ? `🔐 ${data.toolName}` : '🔐 권한 요청'

    const alwaysBtn = document.getElementById('btn-always')
    const suggestion = (data.suggestions ?? [])[0]
    if (suggestion?.type === 'addRules' && suggestion.rules?.[0]?.ruleContent) {
      alwaysBtn.textContent = `항상 \`${suggestion.rules[0].ruleContent}\``
      alwaysBtn.title = `항상 허용: ${suggestion.rules[0].ruleContent}`
    } else {
      alwaysBtn.textContent = '항상 허용'
      alwaysBtn.title = ''
    }
  })
}

const buttons = document.querySelectorAll('[data-decision]')
log(`[perm] [data-decision] 버튼 ${buttons.length}개 발견`)
buttons.forEach(btn => {
  btn.addEventListener('click', (ev) => {
    log('[perm] click event fired', { decision: btn.dataset.decision, button: btn.className })

    const decision = btn.dataset.decision
    const suggestion = decision === 'always'
      ? ((currentData.suggestions ?? [])[0] ?? null)
      : null

    const payload = {
      decision,
      toolName: currentData.toolName,
      sessionId: currentData.sessionId,
      suggestion,
    }
    log('[perm] decide payload', payload)

    if (!window.perm?.decide) {
      err('[perm] window.perm.decide 없음 — IPC 전송 불가')
      return
    }
    try {
      window.perm.decide(payload)
      log('[perm] decide IPC sent successfully')
    } catch (e) {
      err('[perm] decide IPC 전송 예외', e)
    }
  })
})

// Global error trap so silent failures show up in main log too.
window.addEventListener('error', (e) => {
  err('[perm] window error:', e.message, e.filename + ':' + e.lineno)
})
