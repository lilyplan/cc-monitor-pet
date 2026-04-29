let currentData = {}

window.perm.onData((data) => {
  currentData = data
  console.log('[perm] perm:data 수신:', data)
  const titleEl = document.getElementById('title')
  titleEl.textContent = data.toolName ? `🔐 ${data.toolName}` : '🔐 권한 요청'
})

document.querySelectorAll('[data-decision]').forEach(btn => {
  btn.addEventListener('click', () => {
    const decision = btn.dataset.decision
    console.log('[perm] 버튼 클릭:', decision, '/ toolName:', currentData.toolName)
    window.perm.decide({ decision, toolName: currentData.toolName, sessionId: currentData.sessionId })
  })
})
