const { request, showError, money, statusText } = require("../../utils/api")
const app = getApp()

Page({
  data: {
    employees: [],
    employeeIndex: 0,
    selectedEmployee: {},
    loginAccount: "anna",
    loginPassword: "demo",
    loginSession: null,
    products: [],
    storageSkuIndex: 0,
    selectedStorageSku: {},
    storagePhone: "13800000000",
    storageQty: 1,
    pointAmount: 20,
    pointReason: "现场服务补偿",
    orders: [],
    salesText: "¥0",
    pickupRequests: [],
    verifyResult: null,
    couponConfirmList: [],
    lotteryConfirmList: [],
    seats: [],
    newPassword: "new-demo"
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    try {
      const boot = await request("/api/bootstrap")
      const employees = boot.employees.filter((item) => item.role !== "admin")
      const selectedEmployee = employees.find((item) => item.employeeId === app.globalData.selectedEmployeeId) || employees[0]
      const productsData = await request("/api/products")
      this.setData({
        employees,
        selectedEmployee,
        employeeIndex: Math.max(0, employees.findIndex((item) => item.employeeId === selectedEmployee.employeeId)),
        products: productsData.products,
        selectedStorageSku: productsData.products[0]
      })
      await this.loadOrders()
      await this.loadPickupRequests()
      await this.loadCouponsLotteryAndSeats()
    } catch (error) {
      showError(error)
    }
  },

  async loadOrders() {
    const data = await request(`/api/orders?employeeId=${this.data.selectedEmployee.employeeId}`)
    const paidOrders = data.orders.filter((item) => item.payStatus === "paid")
    const sales = paidOrders.reduce((sum, item) => sum + item.amount, 0)
    this.setData({
      salesText: money(sales),
      orders: data.orders.map((item) => ({ ...item, statusText: statusText(item.orderStatus), amountText: money(item.amount) }))
    })
  },

  async loadPickupRequests() {
    const data = await request("/api/admin/customer-storage")
    this.setData({
      pickupRequests: data.pickupRequests.map((item) => ({ ...item, statusText: statusText(item.status) }))
    })
  },

  async loadCouponsLotteryAndSeats() {
    const coupons = await request("/api/coupons?userId=user_demo")
    const lottery = await request("/api/lottery/records?userId=user_demo")
    const boot = await request("/api/bootstrap")
    this.setData({
      couponConfirmList: coupons.coupons.map((item) => ({ ...item, statusText: statusText(item.status) })),
      lotteryConfirmList: lottery.records.map((item) => ({ ...item, statusText: statusText(item.status) })),
      seats: (boot.seats || []).map((item) => ({ ...item, statusText: statusText(item.status) }))
    })
  },

  async onEmployeeChange(event) {
    const employeeIndex = Number(event.detail.value)
    const selectedEmployee = this.data.employees[employeeIndex]
    app.globalData.selectedEmployeeId = selectedEmployee.employeeId
    this.setData({ employeeIndex, selectedEmployee })
    await this.loadOrders()
  },

  onLoginAccount(event) {
    this.setData({ loginAccount: event.detail.value })
  },

  onLoginPassword(event) {
    this.setData({ loginPassword: event.detail.value })
  },

  async staffLogin() {
    try {
      const data = await request("/api/staff/login", { method: "POST", data: { account: this.data.loginAccount, password: this.data.loginPassword } })
      const employeeIndex = Math.max(0, this.data.employees.findIndex((item) => item.employeeId === data.employee.employeeId))
      app.globalData.selectedEmployeeId = data.employee.employeeId
      this.setData({ selectedEmployee: data.employee, employeeIndex, loginSession: data.session })
      wx.showToast({ title: "登录成功" })
      await this.loadOrders()
    } catch (error) {
      showError(error)
    }
  },

  onStoragePhone(event) {
    this.setData({ storagePhone: event.detail.value })
  },

  onStorageQty(event) {
    this.setData({ storageQty: Number(event.detail.value || 1) })
  },

  onStorageSkuChange(event) {
    const storageSkuIndex = Number(event.detail.value)
    this.setData({ storageSkuIndex, selectedStorageSku: this.data.products[storageSkuIndex] })
  },

  onPointAmount(event) {
    this.setData({ pointAmount: Number(event.detail.value || 0) })
  },

  onPointReason(event) {
    this.setData({ pointReason: event.detail.value })
  },

  async addStorage() {
    try {
      await request("/api/staff/storage", {
        method: "POST",
        data: {
          operatorId: this.data.selectedEmployee.employeeId,
          phone: this.data.storagePhone,
          skuId: this.data.selectedStorageSku.skuId,
          quantity: this.data.storageQty,
          agreementAccepted: true,
          reason: "小程序员工端新增存酒"
        }
      })
      wx.showToast({ title: "已新增存酒" })
    } catch (error) {
      showError(error)
    }
  },

  async confirmPickup(event) {
    try {
      await request(`/api/staff/storage/pickup-requests/${event.currentTarget.dataset.id}/confirm`, {
        method: "POST",
        data: { operatorId: this.data.selectedEmployee.employeeId }
      })
      wx.showToast({ title: "已确认" })
      await this.loadPickupRequests()
    } catch (error) {
      showError(error)
    }
  },

  async rejectPickup(event) {
    try {
      await request(`/api/staff/storage/pickup-requests/${event.currentTarget.dataset.id}/reject`, {
        method: "POST",
        data: { operatorId: this.data.selectedEmployee.employeeId, reason: "员工端拒绝取酒" }
      })
      wx.showToast({ title: "已拒绝" })
      await this.loadPickupRequests()
    } catch (error) {
      showError(error)
    }
  },

  async adjustPoints() {
    try {
      await request("/api/staff/points/adjust", {
        method: "POST",
        data: {
          operatorId: this.data.selectedEmployee.employeeId,
          userId: app.globalData.userId,
          amount: this.data.pointAmount,
          reason: this.data.pointReason
        }
      })
      wx.showToast({ title: "积分已调整" })
    } catch (error) {
      showError(error)
    }
  }
,
  onNewPassword(event) {
    this.setData({ newPassword: event.detail.value })
  },

  async verifyCode() {
    try {
      const verifyResult = await request("/api/staff/verify-code", { method: "POST", data: { userId: "user_demo" } })
      this.setData({ verifyResult })
    } catch (error) {
      showError(error)
    }
  },

  async confirmCoupon(event) {
    try {
      await request(`/api/staff/coupons/${event.currentTarget.dataset.id}/confirm`, { method: "POST", data: { operatorId: this.data.selectedEmployee.employeeId } })
      wx.showToast({ title: "已确认券" })
      await this.loadCouponsLotteryAndSeats()
    } catch (error) {
      showError(error)
    }
  },

  async confirmLottery(event) {
    try {
      await request(`/api/staff/lottery-records/${event.currentTarget.dataset.id}/confirm`, { method: "POST", data: { operatorId: this.data.selectedEmployee.employeeId } })
      wx.showToast({ title: "奖品已核销" })
      await this.loadCouponsLotteryAndSeats()
    } catch (error) {
      showError(error)
    }
  },

  async sitSeat(event) {
    await this.seatAction(event.currentTarget.dataset.seat, "sit")
  },

  async eliminateSeat(event) {
    await this.seatAction(event.currentTarget.dataset.seat, "eliminate")
  },

  async restoreSeat(event) {
    await this.seatAction(event.currentTarget.dataset.seat, "restore")
  },

  async seatAction(seatNo, action) {
    try {
      await request(`/api/staff/seats/${seatNo}/${action}`, { method: "POST", data: { operatorId: this.data.selectedEmployee.employeeId, userId: "user_demo" } })
      wx.showToast({ title: "座位已更新" })
      await this.loadCouponsLotteryAndSeats()
    } catch (error) {
      showError(error)
    }
  },

  async changePassword() {
    try {
      await request("/api/staff/password", { method: "POST", data: { operatorId: this.data.selectedEmployee.employeeId, newPassword: this.data.newPassword } })
      wx.showToast({ title: "密码已修改" })
    } catch (error) {
      showError(error)
    }
  }
})
