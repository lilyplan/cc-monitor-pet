let currentData = {}

window.perm.onData((data) => {
  currentData = data
  console.log('[perm] perm:data 수신:', data)

  const titleEl = document.getElementById('title')
  titleEl.textContent = data.toolName ? `🔐 ${data.toolName}` : '🔐 권한 요청'

  // "항상 허용" 버튼: CC가 제공한 permission_suggestions[0]의 rule 표시
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

document.querySelectorAll('[data-decision]').forEach(btn => {
  btn.addEventListener('click', () => {
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
    console.log('[perm] 버튼 클릭:', payload)

    if (!window.perm?.decide) {
      console.error('[perm] window.perm.decide 없음 — preload 미연결')
      return
    }
    try {
      window.perm.decide(payload)
    } catch (err) {
      console.error('[perm] decide IPC 전송 실패:', err)
    }
  })
})
