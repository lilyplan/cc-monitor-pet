let currentData = {}

window.perm.onData((data) => {
  currentData = data
})

function decide(decision) {
  window.perm.decide({ decision, toolName: currentData.toolName })
}

window.decide = decide
