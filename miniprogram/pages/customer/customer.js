const { request, showError, money, statusText } = require("../../utils/api")
const app = getApp()

Page({
  data: {
    employees: [],
    employeeIndex: 0,
    selectedEmployee: {},
    products: [],
    cartItems: [],
    cartTotal: 0,
    cartTotalText: "¥0",
    currentOrder: null,
    resultText: "",
    orders: [],
    points: { balance: 0, ledgers: [] },
    storage: [],
    tables: [],
    profile: {},
    leaderboard: [],
    myRank: null,
    coupons: [],
    couponRecords: [],
    redeemableCouponId: "",
    rechargeConfigs: [],
    rechargeConfigIndex: 0,
    rechargeConfigLabel: "充500送50",
    rechargeRecords: [],
    checkinRecords: [],
    lotteryRecords: [],
    redeemableLotteryId: "",
    storeLocation: {},
    supportPhone: "",
    scanText: ""
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    try {
      const boot = await request("/api/bootstrap")
      const employees = boot.employees.filter((item) => item.role !== "admin")
      const selectedEmployee = employees.find((item) => item.employeeId === app.globalData.selectedEmployeeId) || employees[0]
      this.setData({
        employees,
        selectedEmployee,
        employeeIndex: Math.max(0, employees.findIndex((item) => item.employeeId === selectedEmployee.employeeId))
      })
      await Promise.all([this.loadProducts(), this.loadCart(), this.loadOrders(), this.loadPoints(), this.loadStorage(), this.loadTables(), this.loadMarketing()])
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
    const employeeId = this.data.selectedEmployee.employeeId
    const data = await request(`/api/cart?userId=${app.globalData.userId}&employeeId=${employeeId}`)
    const cartItems = data.items.map((item) => ({
      ...item,
      subtotalText: money(item.product.price * item.quantity)
    }))
    const total = data.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
    this.setData({ cartItems, cartTotal: total, cartTotalText: money(total) })
  },

  async loadOrders() {
    const data = await request(`/api/orders?userId=${app.globalData.userId}`)
    this.setData({
      orders: data.orders.slice(0, 8).map((item) => ({
        ...item,
        statusText: statusText(item.orderStatus),
        amountText: money(item.amount),
        employeeName: item.employee ? item.employee.name : "自然订单"
      }))
    })
  },

  async loadPoints() {
    const points = await request(`/api/points?userId=${app.globalData.userId}`)
    this.setData({ points })
  },

  async loadStorage() {
    const data = await request(`/api/storage?userId=${app.globalData.userId}`)
    this.setData({
      storage: data.storage.map((item) => ({
        ...item,
        statusText: statusText(item.status),
        expireDate: item.expireAt.slice(0, 10)
      }))
    })
  },

  async loadTables() {
    const data = await request("/api/tables")
    this.setData({
      tables: data.tables.map((item) => ({ ...item, statusText: statusText(item.status) }))
    })
  },

  async loadMarketing() {
    const [profile, leaderboard, coupons, location, support, rechargeRecords, checkin, lotteryRecords] = await Promise.all([
      request(`/api/user/profile?userId=${app.globalData.userId}`),
      request(`/api/leaderboard/points?userId=${app.globalData.userId}`),
      request(`/api/coupons?userId=${app.globalData.userId}`),
      request("/api/store/location"),
      request("/api/support/contact"),
      request(`/api/recharge-records?userId=${app.globalData.userId}`),
      request(`/api/checkin?userId=${app.globalData.userId}`),
      request(`/api/lottery/records?userId=${app.globalData.userId}`)
    ])
    const rechargeConfigs = rechargeRecords.configs || []
    const lotteryList = lotteryRecords.records || []
    this.setData({
      profile: {
        ...profile,
        levelName: profile.level ? profile.level.name : "普通会员",
        balanceText: money(profile.user.balance || 0)
      },
      leaderboard: leaderboard.top10,
      myRank: leaderboard.mine,
      coupons: coupons.coupons.map((item) => ({ ...item, statusText: statusText(item.status) })),
      couponRecords: coupons.records.map((item) => ({ ...item, statusText: statusText(item.status) })),
      redeemableCouponId: (coupons.coupons.find((item) => item.status === "available") || {}).couponId || "",
      rechargeConfigs: rechargeConfigs.map((item) => ({ ...item, label: `充${item.amount}送${item.giftAmount}` })),
      rechargeConfigLabel: rechargeConfigs[this.data.rechargeConfigIndex] ? `充${rechargeConfigs[this.data.rechargeConfigIndex].amount}送${rechargeConfigs[this.data.rechargeConfigIndex].giftAmount}` : "充500送50",
      rechargeRecords: rechargeRecords.records.map((item) => ({ ...item, amountText: money(item.amount), giftText: money(item.giftAmount), balanceText: money(item.balanceAfter) })),
      checkinRecords: checkin.records,
      lotteryRecords: lotteryList.map((item) => ({ ...item, statusText: statusText(item.status) })),
      redeemableLotteryId: (lotteryList.find((item) => item.status === "won") || {}).recordId || "",
      storeLocation: location.location,
      supportPhone: support.phone
    })
  },

  async onEmployeeChange(event) {
    const employeeIndex = Number(event.detail.value)
    const selectedEmployee = this.data.employees[employeeIndex]
    app.globalData.selectedEmployeeId = selectedEmployee.employeeId
    this.setData({ employeeIndex, selectedEmployee })
    await this.loadCart()
  },

  async scanEmployeeCode() {
    try {
      let rawCode = `employee:${this.data.selectedEmployee.employeeId}`
      if (wx.scanCode) {
        try {
          const result = await new Promise((resolve, reject) => wx.scanCode({ onlyFromCamera: false, success: resolve, fail: reject }))
          rawCode = result.result || rawCode
        } catch (_error) {
          rawCode = `employee:${this.data.selectedEmployee.employeeId}`
        }
      }
      const employeeId = rawCode.includes("employee:") ? rawCode.split("employee:")[1] : this.data.selectedEmployee.employeeId
      const data = await request("/api/scan/employee", { method: "POST", data: { userId: app.globalData.userId, employeeId, rawCode } })
      const employeeIndex = Math.max(0, this.data.employees.findIndex((item) => item.employeeId === data.employee.employeeId))
      app.globalData.selectedEmployeeId = data.employee.employeeId
      this.setData({ selectedEmployee: data.employee, employeeIndex, scanText: `已扫码归属：${data.employee.name}` })
      await this.loadCart()
      wx.showToast({ title: "扫码成功" })
    } catch (error) {
      showError(error)
    }
  },

  async addToCart(event) {
    try {
      await request("/api/cart/items", {
        method: "POST",
        data: {
          userId: app.globalData.userId,
          employeeId: this.data.selectedEmployee.employeeId,
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
    } catch (error) {
      showError(error)
    }
  }
,
  async checkin() {
    try {
      await request("/api/checkin", { method: "POST", data: { userId: app.globalData.userId } })
      wx.showToast({ title: "签到成功" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async recharge() {
    try {
      const config = this.data.rechargeConfigs[this.data.rechargeConfigIndex]
      await request("/api/recharge", { method: "POST", data: { userId: app.globalData.userId, configId: config ? config.configId : undefined, amount: config ? undefined : 500, giftAmount: config ? undefined : 50 } })
      wx.showToast({ title: "充值成功" })
      await this.loadMarketing()
    } catch (error) {
      showError(error)
    }
  },

  onRechargeConfigChange(event) {
    const rechargeConfigIndex = Number(event.detail.value)
    const config = this.data.rechargeConfigs[rechargeConfigIndex]
    this.setData({ rechargeConfigIndex, rechargeConfigLabel: config ? config.label : "充500送50" })
  },

  async drawLottery() {
    try {
      const data = await request("/api/lottery/draw", { method: "POST", data: { userId: app.globalData.userId } })
      wx.showToast({ title: data.prize.name, icon: "none" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async requestLotteryRedeem(event) {
    try {
      await request(`/api/lottery/records/${event.currentTarget.dataset.id}/redeem-request`, { method: "POST", data: { userId: app.globalData.userId } })
      wx.showToast({ title: "已申请核销" })
      await this.loadMarketing()
    } catch (error) {
      showError(error)
    }
  },

  async requestCouponRedeem(event) {
    try {
      await request(`/api/coupons/${event.currentTarget.dataset.id}/redeem-request`, { method: "POST", data: { userId: app.globalData.userId } })
      wx.showToast({ title: "已申请兑换" })
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
