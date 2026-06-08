const { request, showError, money, statusText } = require("../../utils/api")

Page({
  data: {
    dashboard: {},
    orders: [],
    products: [],
    storage: [],
    reservations: [],
    logs: [],
    finance: {},
    businessDetails: [],
    rechargeConfigs: [],
    memberLevels: [],
    lotteryOverview: {},
    lotteryPrizes: [],
    lotterySettings: {},
    systemSettings: {},
    blindSettings: {}
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    try {
      await Promise.all([this.loadDashboard(), this.loadOrders(), this.loadProducts(), this.loadStorage(), this.loadReservations(), this.loadLogs(), this.loadV3Admin()])
    } catch (error) {
      showError(error)
    }
  },

  async loadDashboard() {
    const data = await request("/api/admin/dashboard")
    this.setData({
      dashboard: {
        ...data,
        todayRevenueText: money(data.todayRevenue),
        lowStockCount: data.lowStock.length,
        pendingOrderCount: data.pendingOrders.length
      }
    })
  },

  async loadOrders() {
    const data = await request("/api/admin/orders")
    this.setData({
      orders: data.orders.map((item) => ({
        ...item,
        amountText: money(item.amount),
        statusText: statusText(item.orderStatus),
        employeeName: item.employee ? item.employee.name : "自然订单"
      }))
    })
  },

  async loadProducts() {
    const data = await request("/api/admin/products")
    this.setData({
      products: data.products.map((item) => ({ ...item, priceText: money(item.price) }))
    })
  },

  async loadStorage() {
    const data = await request("/api/admin/customer-storage")
    this.setData({
      storage: data.storage.map((item) => ({ ...item, statusText: statusText(item.status), expireDate: item.expireAt.slice(0, 10) }))
    })
  },

  async loadReservations() {
    const data = await request("/api/admin/reservations")
    this.setData({
      reservations: data.reservations.map((item) => ({
        ...item,
        statusText: statusText(item.status),
        reservationDate: item.reservationTime.slice(0, 16)
      }))
    })
  },

  async loadLogs() {
    const data = await request("/api/admin/operation-logs")
    this.setData({ logs: data.logs.slice(0, 12) })
  },

  async loadV3Admin() {
    const [finance, business, recharge, levels, lotteryOverview, lotteryPrizes, system, blind] = await Promise.all([
      request("/api/admin/finance/overview"),
      request("/api/admin/business-details"),
      request("/api/admin/recharge-configs"),
      request("/api/admin/member-levels"),
      request("/api/admin/lottery/overview"),
      request("/api/admin/lottery/prizes"),
      request("/api/admin/system-settings"),
      request("/api/admin/blind-settings")
    ])
    this.setData({
      finance: {
        ...finance,
        todayRevenueText: money(finance.todayRevenue),
        monthRevenueText: money(finance.monthRevenue),
        rechargeRevenueText: money(finance.rechargeRevenue)
      },
      businessDetails: business.details,
      rechargeConfigs: recharge.configs,
      memberLevels: levels.levels,
      lotteryOverview,
      lotteryPrizes: lotteryPrizes.prizes,
      lotterySettings: lotteryPrizes.settings,
      systemSettings: system.settings,
      blindSettings: blind.settings
    })
  },

  async completeOrder(event) {
    try {
      await request(`/api/admin/orders/${event.currentTarget.dataset.id}/complete`, { method: "PATCH", data: { reason: "小程序后台标记完成" } })
      wx.showToast({ title: "已完成" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async refundOrder(event) {
    try {
      await request(`/api/admin/orders/${event.currentTarget.dataset.id}/refund`, { method: "POST", data: { reason: "小程序后台退款" } })
      wx.showToast({ title: "已退款" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
  },

  async transferStorage(event) {
    try {
      await request(`/api/admin/orders/${event.currentTarget.dataset.id}/transfer-storage`, {
        method: "POST",
        data: { skuId: "sku_whisky", quantity: 1, operatorId: "emp_admin" }
      })
      wx.showToast({ title: "已转存" })
      await this.loadStorage()
    } catch (error) {
      showError(error)
    }
  },

  async addStock(event) {
    try {
      await request("/api/admin/stock/adjust", {
        method: "POST",
        data: {
          skuId: event.currentTarget.dataset.id,
          targetQty: Number(event.currentTarget.dataset.current) + 10,
          reason: "小程序后台补货"
        }
      })
      wx.showToast({ title: "库存已调整" })
      await this.loadProducts()
    } catch (error) {
      showError(error)
    }
  },

  async confirmReservation(event) {
    try {
      await request(`/api/admin/reservations/${event.currentTarget.dataset.id}`, {
        method: "PATCH",
        data: { status: "confirmed", reason: "小程序后台确认预约" }
      })
      wx.showToast({ title: "已确认" })
      await this.loadReservations()
    } catch (error) {
      showError(error)
    }
  }
,
  async createRechargeConfig() {
    try {
      await request("/api/admin/recharge-configs", { method: "POST", data: { amount: 300, giftAmount: 30 } })
      wx.showToast({ title: "已新增配置" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async createMemberLevel() {
    try {
      await request("/api/admin/member-levels", { method: "POST", data: { name: "黑金会员", minPoints: 2000 } })
      wx.showToast({ title: "已新增等级" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async createPrize() {
    try {
      await request("/api/admin/lottery/prizes", { method: "POST", data: { name: "神秘酒水券", winRate: 10 } })
      wx.showToast({ title: "已新增奖品" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async toggleLottery() {
    try {
      await request("/api/admin/lottery/settings", { method: "PATCH", data: { enabled: !this.data.lotterySettings.enabled } })
      wx.showToast({ title: "抽奖设置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async createEmployee() {
    try {
      await request("/api/admin/employees", { method: "POST", data: { name: "测试员工", phone: `139${Date.now().toString().slice(-8)}`, role: "staff" } })
      wx.showToast({ title: "已新增员工" })
    } catch (error) {
      showError(error)
    }
  },

  async updateSystemSettings() {
    try {
      await request("/api/admin/system-settings", { method: "PATCH", data: { pointsVisible: false, supportPhone: "400-000-0000" } })
      wx.showToast({ title: "系统设置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async updateBlindSettings() {
    try {
      await request("/api/admin/blind-settings", { method: "PATCH", data: { theme: "neon", fontSize: 56, registrationStatus: "stopped" } })
      wx.showToast({ title: "升盲设置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  }
})
