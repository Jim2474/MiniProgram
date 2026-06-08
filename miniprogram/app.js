function resolveEmployeeScene(options) {
  const rawScene = options && options.query && options.query.scene ? decodeURIComponent(options.query.scene) : ""
  if (rawScene.indexOf("employee:") === 0) return rawScene
  return ""
}

App({
  onLaunch(options) {
    this.globalData.pendingEmployeeScene = resolveEmployeeScene(options)
  },

  onShow(options) {
    const scene = resolveEmployeeScene(options)
    if (scene) this.globalData.pendingEmployeeScene = scene
  },

  globalData: {
    userId: "user_demo",
    selectedEmployeeId: "",
    pendingEmployeeScene: "",
    staffSessionId: "",
    backendBaseUrl: "http://localhost:3000"
  }
})
