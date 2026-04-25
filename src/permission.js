let currentData = {}

window.perm.onData((data) => {
  currentData = data
  const titleEl = document.getElementById('title')
  if (data.toolName) {
    titleEl.textContent = `🔐 ${data.toolName}`
  } else {
    titleEl.textContent = '🔐 권한 요청'
  }
})

function decide(decision) {
  window.perm.decide({ decision, toolName: currentData.toolName })
}

window.decide = decide
