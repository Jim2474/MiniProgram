const { request, showError, money, statusText } = require("../../utils/api")
const app = getApp()

Page({
  data: {
    employees: [],
    selectedEmployee: {},
    scannedEmployeeId: "",
    products: [],
    cartItems: [],
    cartTotal: 0,
    cartTotalText: "¥0",
    currentOrder: null,
    resultText: "",
    orders: [],
    todayOrders: [],
    historyOrders: [],
    points: { balance: 0, ledgers: [] },
    storage: [],
    storageLedgers: [],
    pickupRecords: [],
    tables: [],
    reservations: [],
    profile: { user: {} },
    loginPhone: "13800000000",
    loginNickname: "德扑客人",
    bindPhoneValue: "13800000000",
    currentUserId: "user_demo",
    checkinRecords: [],
    checkinCalendar: [],
    verificationCodes: [],
    qrText: "",
    qrImageUrl: "",
    storeLocation: {},
    supportPhone: "",
    scanText: ""
  },

  async onShow() {
    await this.loadAll()
    await this.consumePendingEmployeeScene()
  },

  async loadAll() {
    try {
      const boot = await request("/api/bootstrap")
      const employees = boot.employees.filter((item) => item.role !== "admin")
      const selectedEmployee = employees.find((item) => item.employeeId === app.globalData.selectedEmployeeId) || {}
      this.setData({
        employees,
        selectedEmployee,
        scannedEmployeeId: app.globalData.selectedEmployeeId || "",
        currentUserId: app.globalData.userId
      })
      await Promise.all([this.loadProducts(), this.loadCart(), this.loadOrders(), this.loadPoints(), this.loadStorage(), this.loadTables(), this.loadReservations(), this.loadMarketing()])
    } catch (error) {
      showError(error)
    }
  },

  async loadProducts() {
    const data = await request("/api/products")
    this.setData({
      products: data.products.map((item) => ({
        ...item,
        priceText: money(item.price),
        lowStock: item.stockQty <= item.warningQty
      }))
    })
  },

  async loadCart() {
    const employeeParam = this.data.scannedEmployeeId ? `&employeeId=${this.data.scannedEmployeeId}` : ""
    const data = await request(`/api/cart?userId=${app.globalData.userId}${employeeParam}`)
    const cartItems = data.items.map((item) => ({
      ...item,
      subtotalText: money(item.product.price * item.quantity)
    }))
    const total = data.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
    this.setData({ cartItems, cartTotal: total, cartTotalText: money(total) })
  },

  async loadOrders() {
    const data = await request(`/api/orders?userId=${app.globalData.userId}`)
    const today = new Date().toISOString().slice(0, 10)
    const decoratedOrders = data.orders.map((item) => ({
      ...item,
      statusText: statusText(item.orderStatus),
      amountText: money(item.amount),
      pointsAwardedText: `+${item.pointsAwarded || 0}积分`,
      employeeName: item.employee ? item.employee.name : "自然订单",
      orderDate: (item.paidAt || item.createdAt || "").slice(0, 10)
    }))
    this.setData({
      orders: decoratedOrders.slice(0, 8),
      todayOrders: decoratedOrders.filter((item) => item.orderDate === today),
      historyOrders: decoratedOrders.filter((item) => item.orderDate !== today).slice(0, 12)
    })
  },

  async loadPoints() {
    const points = await request(`/api/points?userId=${app.globalData.userId}`)
    this.setData({ points })
  },

  async loadStorage() {
    const [data, records] = await Promise.all([
      request(`/api/storage?userId=${app.globalData.userId}`),
      request(`/api/storage-records?userId=${app.globalData.userId}`)
    ])
    this.setData({
      storage: data.storage.map((item) => ({
        ...item,
        statusText: statusText(item.status),
        expireDate: item.expireAt.slice(0, 10)
      })),
      storageLedgers: records.ledgers.map((item) => ({
        ...item,
        productName: item.product ? item.product.name : item.skuId,
        recordDate: item.createdAt.slice(0, 10)
      })),
      pickupRecords: records.pickupRequests.map((item) => ({
        ...item,
        statusText: statusText(item.status),
        requestDate: item.createdAt.slice(0, 10)
      }))
    })
  },

  async loadTables() {
    const data = await request("/api/tables")
    this.setData({
      tables: data.tables.map((item) => ({ ...item, statusText: statusText(item.status) }))
    })
  },

  async loadReservations() {
    const data = await request(`/api/reservations?userId=${app.globalData.userId}`)
    this.setData({
      reservations: data.reservations.map((item) => ({
        ...item,
        statusText: statusText(item.status),
        reservationDate: item.reservationTime.slice(0, 16)
      }))
    })
  },

  async loadMarketing() {
    const [profile, location, support, checkin, verificationCodes] = await Promise.all([
      request(`/api/user/profile?userId=${app.globalData.userId}`),
      request("/api/store/location"),
      request("/api/support/contact"),
      request(`/api/checkin?userId=${app.globalData.userId}`),
      request(`/api/verification-codes?userId=${app.globalData.userId}`)
    ])
    this.setData({
      profile: {
        ...profile,
        levelName: profile.level ? profile.level.name : "普通会员"
      },
      currentUserId: profile.user.userId,
      loginPhone: profile.user.phone || this.data.loginPhone,
      bindPhoneValue: profile.user.phone || this.data.bindPhoneValue,
      checkinRecords: checkin.records,
      checkinCalendar: checkin.calendar || [],
      verificationCodes: verificationCodes.codes.map((item) => ({ ...item, statusText: statusText(item.status) })),
      storeLocation: location.location,
      supportPhone: support.phone
    })
  },

  onLoginPhone(event) {
    this.setData({ loginPhone: event.detail.value })
  },

  onLoginNickname(event) {
    this.setData({ loginNickname: event.detail.value })
  },

  onBindPhone(event) {
    this.setData({ bindPhoneValue: event.detail.value })
  },

  async loginCustomer() {
    try {
      const payload = { phone: this.data.loginPhone, nickname: this.data.loginNickname }
      if (wx.login) {
        try {
          const loginResult = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
          if (loginResult.code) payload.code = loginResult.code
        } catch (_error) {
          // 开发者工具或本地 mock 失败时，后端仍可按手机号走开发态模拟登录。
        }
      }
      const data = await request("/api/wechat/login", {
        method: "POST",
        data: payload
      })
      app.globalData.userId = data.user.userId
      this.setData({ currentUserId: data.user.userId, bindPhoneValue: data.user.phone || this.data.bindPhoneValue })
      wx.showToast({ title: "登录成功" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async bindPhone() {
    try {
      const data = await request("/api/user/bind-phone", {
        method: "POST",
        data: { userId: app.globalData.userId, phone: this.data.bindPhoneValue }
      })
      this.setData({ bindPhoneValue: data.user.phone || this.data.bindPhoneValue })
      wx.showToast({ title: "手机号已绑定" })
      await this.loadMarketing()
    } catch (error) {
      showError(error)
    }
  },

  async bindWechatPhone(event) {
    try {
      const code = event.detail && event.detail.code
      if (!code) throw new Error("未获得微信手机号授权")
      const data = await request("/api/user/bind-phone", {
        method: "POST",
        data: { userId: app.globalData.userId, code }
      })
      this.setData({ bindPhoneValue: data.user.phone || this.data.bindPhoneValue })
      wx.showToast({ title: "手机号已授权" })
      await this.loadMarketing()
    } catch (error) {
      showError(error)
    }
  },

  async scanEmployeeCode() {
    try {
      let rawCode = ""
      if (wx.scanCode) {
        try {
          const result = await new Promise((resolve, reject) => wx.scanCode({ onlyFromCamera: false, success: resolve, fail: reject }))
          rawCode = result.result || rawCode
        } catch (_error) {
          rawCode = this.data.scannedEmployeeId ? `employee:${this.data.scannedEmployeeId}` : ""
        }
      }
      if (!rawCode) throw new Error("请扫描员工专属二维码")
      const employeeId = rawCode.includes("employee:") ? rawCode.split("employee:")[1] : ""
      if (!employeeId) throw new Error("员工二维码格式不正确")
      await this.bindEmployeeScene({ employeeId, rawCode })
      wx.showToast({ title: "扫码成功" })
    } catch (error) {
      showError(error)
    }
  },

  async consumePendingEmployeeScene() {
    const scene = app.globalData.pendingEmployeeScene
    if (!scene) return
    app.globalData.pendingEmployeeScene = ""
    const employeeId = scene.indexOf("employee:") === 0 ? scene.split("employee:")[1] : ""
    if (!employeeId) return
    await this.bindEmployeeScene({ employeeId, scene })
  },

  async bindEmployeeScene({ employeeId, rawCode = "", scene = "" }) {
    const data = await request("/api/scan/employee", { method: "POST", data: { userId: app.globalData.userId, employeeId, rawCode, scene } })
    app.globalData.selectedEmployeeId = data.employee.employeeId
    this.setData({ selectedEmployee: data.employee, scannedEmployeeId: data.employee.employeeId, scanText: `已扫码归属：${data.employee.name}` })
    await this.loadCart()
  },

  async addToCart(event) {
    try {
      await request("/api/cart/items", {
        method: "POST",
        data: {
          userId: app.globalData.userId,
          employeeId: this.data.scannedEmployeeId || undefined,
          skuId: event.currentTarget.dataset.sku,
          quantity: 1
        }
      })
      wx.showToast({ title: "已加入" })
      await this.loadCart()
    } catch (error) {
      showError(error)
    }
  },

  showProductDetail(event) {
    const product = this.data.products.find((item) => item.skuId === event.currentTarget.dataset.sku)
    if (!product) return
    wx.showModal({
      title: product.name,
      content: `${product.spec}\n${product.description || "暂无描述"}\n价格：${product.priceText}\n库存：${product.stockQty}`,
      showCancel: false
    })
  },

  async removeCartItem(event) {
    try {
      await request(`/api/cart/items/${event.currentTarget.dataset.id}`, { method: "DELETE" })
      await this.loadCart()
    } catch (error) {
      showError(error)
    }
  },

  async createOrder() {
    try {
      const data = await request("/api/orders", { method: "POST", data: { userId: app.globalData.userId } })
      this.setData({ currentOrder: data.order, resultText: `订单已创建：${data.order.amountText || money(data.order.amount)}` })
      await this.loadCart()
      await this.loadOrders()
      wx.showToast({ title: "订单已创建" })
    } catch (error) {
      showError(error)
    }
  },

  async payOrder() {
    try {
      const data = await request(`/api/orders/${this.data.currentOrder.orderId}/pay`, { method: "POST" })
      if (data.prepay) {
        if (!wx.requestPayment) throw new Error("当前环境不支持微信支付")
        await new Promise((resolve, reject) => wx.requestPayment({ ...data.prepay, success: resolve, fail: reject }))
        this.setData({
          resultText: "微信支付已提交，等待支付回调确认订单。",
          currentOrder: data.order
        })
        await this.loadOrders()
        return
      }
      this.setData({
        currentOrder: null,
        resultText: `支付成功，积分 +${data.order.pointsAwarded}，归属 ${data.order.employee ? data.order.employee.name : "自然订单"}`
      })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async requestPickup(event) {
    try {
      await request(`/api/storage/${event.currentTarget.dataset.id}/pickup-requests`, { method: "POST", data: { quantity: 1 } })
      wx.showToast({ title: "已申请" })
      await this.loadStorage()
    } catch (error) {
      showError(error)
    }
  },

  async createReservation(event) {
    try {
      await request("/api/reservations", {
        method: "POST",
        data: {
          userId: app.globalData.userId,
          tableId: event.currentTarget.dataset.id,
          reservationTime: new Date().toISOString(),
          remark: "小程序预约"
        }
      })
      wx.showToast({ title: "已预约" })
      await this.loadReservations()
    } catch (error) {
      showError(error)
    }
  },

  async cancelReservation(event) {
    try {
      await request(`/api/reservations/${event.currentTarget.dataset.id}/cancel`, { method: "POST", data: { reason: "客户小程序取消" } })
      wx.showToast({ title: "已取消" })
      await this.loadReservations()
      await this.loadTables()
    } catch (error) {
      showError(error)
    }
  },

  async checkin() {
    try {
      await request("/api/checkin", { method: "POST", data: { userId: app.globalData.userId } })
      wx.showToast({ title: "签到成功" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async createQrCode(event) {
    try {
      const type = event.currentTarget.dataset.type
      const payload = { userId: app.globalData.userId, type }
      if (type === "points") payload.pointsAmount = 5
      if (type === "storage") {
        const storage = this.data.storage.find((item) => item.status === "available" && item.quantity > 0)
        if (!storage) throw new Error("暂无可取存酒")
        payload.storageId = storage.storageId
      }
      const data = await request("/api/verification-codes", { method: "POST", data: payload })
      this.setData({ qrText: data.code.qrPayload, qrImageUrl: data.code.qrImageUrl })
      wx.showModal({ title: "二维码码值", content: data.code.qrPayload, showCancel: false })
      await this.loadMarketing()
    } catch (error) {
      showError(error)
    }
  },

  openStoreLocation() {
    const location = this.data.storeLocation
    if (!location.latitude || !location.longitude || !wx.openLocation) return
    wx.openLocation({
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      name: "河岸德扑酒馆",
      address: location.address,
      scale: 16
    })
  },

  callSupport() {
    if (!this.data.supportPhone || !wx.makePhoneCall) return
    wx.makePhoneCall({ phoneNumber: this.data.supportPhone })
  }
})
