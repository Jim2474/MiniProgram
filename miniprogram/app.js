function resolveEmployeeScene(options) {
  const rawScene = options && options.query && options.query.scene ? decodeURIComponent(options.query.scene) : ""
  if (rawScene.indexOf("employee:") === 0) return rawScene
  return ""
}

function resolveVerificationScene(options) {
  const rawScene = options && options.query && options.query.scene ? decodeURIComponent(options.query.scene) : ""
  if (rawScene.indexOf("verify:") === 0) return rawScene
  return ""
}

App({
  onLaunch(options) {
    this.globalData.pendingEmployeeScene = resolveEmployeeScene(options)
    this.globalData.pendingVerificationScene = resolveVerificationScene(options)
  },

  onShow(options) {
    const scene = resolveEmployeeScene(options)
    if (scene) this.globalData.pendingEmployeeScene = scene
    const verificationScene = resolveVerificationScene(options)
    if (verificationScene) this.globalData.pendingVerificationScene = verificationScene
  },

  globalData: {
    userId: "user_demo",
    selectedEmployeeId: "",
    pendingEmployeeScene: "",
    pendingVerificationScene: "",
    staffSessionId: "",
    backendBaseUrl: "http://localhost:3000"
  }
})
