const app = getApp()

function baseUrl() {
  return app.globalData.backendBaseUrl || "http://localhost:3000"
}

function request(path, options = {}) {
  const header = {
    "content-type": "application/json"
  }
  if (app.globalData.staffSessionId) {
    header["x-staff-session"] = app.globalData.staffSessionId
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl()}${path}`,
      method: options.method || "GET",
      data: options.data || {},
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error((res.data && res.data.error) || `请求失败 ${res.statusCode}`))
        }
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"))
      }
    })
  })
}

function showError(error) {
  wx.showToast({
    title: error.message || "操作失败",
    icon: "none"
  })
}

function money(value) {
  return `¥${Number(value || 0).toFixed(0)}`
}

function statusText(status) {
  const map = {
    unpaid: "待支付",
    pending: "待处理",
    completed: "已完成",
    refunded: "已退款",
    closed: "已关闭",
    available: "可取",
    empty: "已取完",
    expired: "已过期",
    disposed: "已作废",
    cancelled: "已取消",
    confirmed: "已确认",
    rejected: "已拒绝",
    reserved: "预订",
    occupied: "占用",
    maintenance: "维护",
    running: "进行中",
    paused: "已暂停",
    redeeming: "待核销",
    won: "已中奖",
    active: "启用",
    disabled: "停用",
    used: "已使用"
  }
  return map[status] || status
}

module.exports = {
  request,
  showError,
  money,
  statusText
}
