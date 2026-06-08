const { request, showError, money, statusText } = require("../../utils/api")

Page({
  data: {
    dashboard: {},
    orders: [],
    products: [],
    productCategories: [],
    productKeyword: "",
    storage: [],
    reservations: [],
    tables: [],
    tableTypes: [],
    tableKeyword: "",
    tableStatusOptions: [
      { label: "全部", value: "" },
      { label: "空闲", value: "available" },
      { label: "占用", value: "occupied" },
      { label: "预订", value: "reserved" },
      { label: "维护", value: "maintenance" },
      { label: "禁用", value: "disabled" }
    ],
    tableStatusIndex: 0,
    tablePagination: { page: 1, pageSize: 5, total: 0, pageCount: 1 },
    tableSummary: {},
    logs: [],
    stockRequests: [],
    stockLedgers: [],
    finance: {},
    businessDetails: [],
    rechargeConfigs: [],
    rechargeRecords: [],
    consumptionRecords: [],
    memberLevels: [],
    lotteryOverview: {},
    lotteryPrizes: [],
    lotterySettings: {},
    pointsConfig: {},
    scanRecords: [],
    systemSettings: {},
    blindSettings: {},
    blindForm: {
      theme: "classic",
      backgroundImage: "",
      logo: "",
      fontColor: "#FFFFFF",
      timerColor: "#F8D66D",
      breakColor: "#7DD3FC",
      dialogColor: "#15221B",
      fontSize: 48,
      fontFamily: "system",
      registrationStatus: "accepting",
      championBackgroundImage: "",
      voiceType: "default",
      voiceStartText: "开始提示音",
      voiceEndText: "结束提示音",
      entrants: 9,
      totalBuyins: 0,
      levelTitle: "LEVEL",
      playerLeftTitle: "PLAYER LEFT",
      blindsTitle: "BLINDS",
      entrantsTitle: "ENTRANTS",
      smallBlindTerm: "小盲",
      bigBlindTerm: "大盲",
      anteTerm: "前注"
    },
    productForm: {
      categoryIndex: 0,
      name: "气泡水",
      price: 18,
      stockQty: 12,
      warningQty: 2,
      storageDays: 30
    },
    tableForm: {
      name: "B2 新桌",
      type: "普通卡座",
      capacity: 9
    }
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    try {
      await Promise.all([this.loadDashboard(), this.loadOrders(), this.loadProducts(), this.loadStorage(), this.loadReservations(), this.loadTables(), this.loadLogs(), this.loadV3Admin()])
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
        yesterdayRevenueText: money(data.yesterdayRevenue),
        revenueDeltaText: money(data.revenueDelta),
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
    const keyword = this.data.productKeyword ? `?keyword=${encodeURIComponent(this.data.productKeyword)}` : ""
    const data = await request(`/api/admin/products${keyword}`)
    this.setData({
      products: data.products.map((item) => ({ ...item, priceText: money(item.price) })),
      productCategories: data.categories
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

  async loadTables() {
    const status = this.data.tableStatusOptions[this.data.tableStatusIndex].value
    const params = [`page=${this.data.tablePagination.page}`, `pageSize=${this.data.tablePagination.pageSize}`]
    if (this.data.tableKeyword) params.push(`keyword=${encodeURIComponent(this.data.tableKeyword)}`)
    if (status) params.push(`status=${status}`)
    const data = await request(`/api/admin/tables?${params.join("&")}`)
    this.setData({
      tables: data.tables.map((item) => ({ ...item, statusText: statusText(item.status), consumptionText: money(item.consumptionAmount) })),
      tableTypes: data.tableTypes,
      tablePagination: data.pagination,
      tableSummary: data.summary
    })
  },

  async loadLogs() {
    const data = await request("/api/admin/operation-logs")
    this.setData({ logs: data.logs.slice(0, 12) })
  },

  async loadV3Admin() {
    const [finance, business, recharge, rechargeRecords, consumptionRecords, levels, pointsConfig, lotteryOverview, lotteryPrizes, stockRequests, stockLedgers, scanRecords, system, blind] = await Promise.all([
      request("/api/admin/finance/overview"),
      request("/api/admin/business-details"),
      request("/api/admin/recharge-configs"),
      request("/api/admin/recharge-records"),
      request("/api/admin/consumption-records"),
      request("/api/admin/member-levels"),
      request("/api/admin/points-config"),
      request("/api/admin/lottery/overview"),
      request("/api/admin/lottery/prizes"),
      request("/api/admin/stock-requests"),
      request("/api/admin/stock-ledgers"),
      request("/api/admin/scan-records"),
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
      rechargeRecords: rechargeRecords.records.map((item) => ({ ...item, amountText: money(item.amount), giftText: money(item.giftAmount), balanceText: money(item.balanceAfter) })),
      consumptionRecords: consumptionRecords.records.map((item) => ({ ...item, amountText: money(item.amount), statusText: statusText(item.orderStatus) })),
      memberLevels: levels.levels,
      pointsConfig: pointsConfig.config,
      lotteryOverview,
      lotteryPrizes: lotteryPrizes.prizes,
      lotterySettings: lotteryPrizes.settings,
      stockRequests: stockRequests.requests.map((item) => ({ ...item, statusText: statusText(item.status), directionText: item.direction === "in" ? "入库" : "出库" })),
      stockLedgers: stockLedgers.ledgers.slice(0, 8),
      scanRecords: scanRecords.records.slice(0, 8),
      systemSettings: system.settings,
      blindSettings: blind.settings,
      blindForm: {
        ...this.data.blindForm,
        ...blind.settings,
        levelTitle: blind.settings.titleMap?.level || this.data.blindForm.levelTitle,
        playerLeftTitle: blind.settings.titleMap?.playerLeft || this.data.blindForm.playerLeftTitle,
        blindsTitle: blind.settings.titleMap?.blinds || this.data.blindForm.blindsTitle,
        entrantsTitle: blind.settings.titleMap?.entrants || this.data.blindForm.entrantsTitle,
        smallBlindTerm: blind.settings.voiceTerms?.smallBlind || this.data.blindForm.smallBlindTerm,
        bigBlindTerm: blind.settings.voiceTerms?.bigBlind || this.data.blindForm.bigBlindTerm,
        anteTerm: blind.settings.voiceTerms?.ante || this.data.blindForm.anteTerm
      }
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

  onProductKeyword(event) {
    this.setData({ productKeyword: event.detail.value })
  },

  async searchProducts() {
    await this.loadProducts()
  },

  onProductCategoryChange(event) {
    this.setData({ "productForm.categoryIndex": Number(event.detail.value) })
  },

  onProductName(event) {
    this.setData({ "productForm.name": event.detail.value })
  },

  onProductPrice(event) {
    this.setData({ "productForm.price": Number(event.detail.value || 0) })
  },

  onProductStock(event) {
    this.setData({ "productForm.stockQty": Number(event.detail.value || 0) })
  },

  onProductWarning(event) {
    this.setData({ "productForm.warningQty": Number(event.detail.value || 0) })
  },

  onProductStorageDays(event) {
    this.setData({ "productForm.storageDays": Number(event.detail.value || 0) })
  },

  async createCategory() {
    try {
      await request("/api/admin/categories", { method: "POST", data: { name: `新分类${Date.now().toString().slice(-3)}` } })
      wx.showToast({ title: "分类已新增" })
      await this.loadProducts()
    } catch (error) {
      showError(error)
    }
  },

  async createProduct() {
    try {
      const category = this.data.productCategories[this.data.productForm.categoryIndex] || this.data.productCategories[0]
      await request("/api/admin/products", {
        method: "POST",
        data: {
          categoryId: category.categoryId,
          name: this.data.productForm.name,
          spec: "标准规格",
          unit: "份",
          price: this.data.productForm.price,
          stockQty: this.data.productForm.stockQty,
          warningQty: this.data.productForm.warningQty,
          description: "后台新增 SKU",
          storageDays: this.data.productForm.storageDays
        }
      })
      wx.showToast({ title: "SKU 已新增" })
      await this.loadProducts()
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async toggleProduct(event) {
    try {
      const status = event.currentTarget.dataset.status === "active" ? "disabled" : "active"
      await request(`/api/admin/products/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status, operatorId: "emp_admin" } })
      wx.showToast({ title: status === "active" ? "已上架" : "已下架" })
      await this.loadProducts()
    } catch (error) {
      showError(error)
    }
  },

  async toggleCategory(event) {
    try {
      const status = event.currentTarget.dataset.status === "active" ? "disabled" : "active"
      await request(`/api/admin/categories/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status, operatorId: "emp_admin" } })
      wx.showToast({ title: status === "active" ? "分类启用" : "分类停用" })
      await this.loadProducts()
    } catch (error) {
      showError(error)
    }
  },

  async createStockRequest(event) {
    try {
      await request("/api/admin/stock-requests", {
        method: "POST",
        data: { skuId: event.currentTarget.dataset.id, direction: event.currentTarget.dataset.direction, quantity: 3, operatorId: "emp_admin" }
      })
      wx.showToast({ title: "申请已提交" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async confirmStockRequest(event) {
    try {
      await request(`/api/admin/stock-requests/${event.currentTarget.dataset.id}/confirm`, { method: "POST", data: { operatorId: "emp_admin" } })
      wx.showToast({ title: "已确认" })
      await this.loadProducts()
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async rejectStockRequest(event) {
    try {
      await request(`/api/admin/stock-requests/${event.currentTarget.dataset.id}/reject`, { method: "POST", data: { operatorId: "emp_admin", reason: "后台驳回" } })
      wx.showToast({ title: "已驳回" })
      await this.loadV3Admin()
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
  async expireReservation(event) {
    try {
      await request(`/api/admin/reservations/${event.currentTarget.dataset.id}`, {
        method: "PATCH",
        data: { status: "expired", reason: "小程序后台标记失效" }
      })
      wx.showToast({ title: "已失效" })
      await this.loadReservations()
      await this.loadTables()
    } catch (error) {
      showError(error)
    }
  },

  async handleExpiredStorage(event) {
    try {
      await request(`/api/admin/storage/${event.currentTarget.dataset.id}/expire-handle`, {
        method: "POST",
        data: { operatorId: "emp_admin", action: "dispose", note: "后台人工确认过期作废" }
      })
      wx.showToast({ title: "已处理" })
      await this.loadStorage()
    } catch (error) {
      showError(error)
    }
  },

  onTableName(event) {
    this.setData({ "tableForm.name": event.detail.value })
  },

  onTableCapacity(event) {
    this.setData({ "tableForm.capacity": Number(event.detail.value || 1) })
  },

  onTableKeyword(event) {
    this.setData({ tableKeyword: event.detail.value, "tablePagination.page": 1 })
  },

  onTableStatusChange(event) {
    this.setData({ tableStatusIndex: Number(event.detail.value), "tablePagination.page": 1 })
    this.loadTables()
  },

  async searchTables() {
    this.setData({ "tablePagination.page": 1 })
    await this.loadTables()
  },

  async prevTablePage() {
    const page = Math.max(1, this.data.tablePagination.page - 1)
    this.setData({ "tablePagination.page": page })
    await this.loadTables()
  },

  async nextTablePage() {
    const page = Math.min(this.data.tablePagination.pageCount || 1, this.data.tablePagination.page + 1)
    this.setData({ "tablePagination.page": page })
    await this.loadTables()
  },

  async createTable() {
    try {
      await request("/api/admin/tables", { method: "POST", data: { ...this.data.tableForm, operatorId: "emp_admin" } })
      wx.showToast({ title: "桌台已新增" })
      await this.loadTables()
      await this.loadDashboard()
    } catch (error) {
      showError(error)
    }
  },

  async occupyTable(event) {
    try {
      await request(`/api/admin/tables/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status: "occupied", consumptionAmount: 388, reason: "后台开台" } })
      wx.showToast({ title: "已开台" })
      await this.loadTables()
      await this.loadDashboard()
    } catch (error) {
      showError(error)
    }
  },

  async disableTable(event) {
    try {
      await request(`/api/admin/tables/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status: "maintenance", reason: "后台维护" } })
      wx.showToast({ title: "已维护" })
      await this.loadTables()
      await this.loadDashboard()
    } catch (error) {
      showError(error)
    }
  },

  async createRechargeConfig() {
    try {
      await request("/api/admin/recharge-configs", { method: "POST", data: { amount: 300, giftAmount: 30 } })
      wx.showToast({ title: "已新增配置" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async disableRechargeConfig(event) {
    try {
      await request(`/api/admin/recharge-configs/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status: "disabled", operatorId: "emp_admin" } })
      wx.showToast({ title: "配置已停用" })
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

  async disableMemberLevel(event) {
    try {
      await request(`/api/admin/member-levels/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status: "disabled", operatorId: "emp_admin" } })
      wx.showToast({ title: "等级已停用" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  async updatePointsConfig() {
    try {
      await request("/api/admin/points-config", { method: "PATCH", data: { checkinPoints: 12, couponExchangePoints: 80, pointExpireDays: 180, pointsVisible: true } })
      wx.showToast({ title: "积分配置已更新" })
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

  async disablePrize(event) {
    try {
      await request(`/api/admin/lottery/prizes/${event.currentTarget.dataset.id}`, { method: "PATCH", data: { status: "disabled", winRate: 0, operatorId: "emp_admin" } })
      wx.showToast({ title: "奖品已停用" })
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

  async updateLotteryRules() {
    try {
      await request("/api/admin/lottery/settings", { method: "PATCH", data: { dailyLimit: 5, cooldownMinutes: 10, costPoints: 20 } })
      wx.showToast({ title: "抽奖规则已更新" })
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

  onBlindField(event) {
    const key = event.currentTarget.dataset.key
    const numericKeys = ["fontSize", "entrants", "totalBuyins"]
    const value = numericKeys.includes(key) ? Number(event.detail.value || 0) : event.detail.value
    this.setData({ [`blindForm.${key}`]: value })
  },

  async updateBlindSettings() {
    try {
      const form = this.data.blindForm
      await request("/api/admin/blind-settings", {
        method: "PATCH",
        data: {
          operatorId: "emp_admin",
          theme: form.theme,
          backgroundImage: form.backgroundImage,
          logo: form.logo,
          fontColor: form.fontColor,
          timerColor: form.timerColor,
          breakColor: form.breakColor,
          dialogColor: form.dialogColor,
          fontSize: form.fontSize,
          fontFamily: form.fontFamily,
          registrationStatus: form.registrationStatus,
          championBackgroundImage: form.championBackgroundImage,
          voiceType: form.voiceType,
          voiceStartText: form.voiceStartText,
          voiceEndText: form.voiceEndText,
          entrants: form.entrants,
          totalBuyins: form.totalBuyins,
          titleMap: {
            level: form.levelTitle,
            playerLeft: form.playerLeftTitle,
            blinds: form.blindsTitle,
            entrants: form.entrantsTitle
          },
          voiceTerms: {
            smallBlind: form.smallBlindTerm,
            bigBlind: form.bigBlindTerm,
            ante: form.anteTerm
          }
        }
      })
      wx.showToast({ title: "升盲设置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  }
})
