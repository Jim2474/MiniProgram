const { request, showError, money, statusText } = require("../../utils/api")
const app = getApp()

Page({
  data: {
    loginAccount: "admin",
    loginPassword: "demo",
    loginSession: null,
    dashboard: {},
    staffSales: [],
    orders: [],
    products: [],
    productCategories: [],
    productKeyword: "",
    users: [],
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
    stockCounts: [],
    stockRequestForm: {
      quantity: 1,
      reason: "日常库存调整"
    },
    stockCountForm: {
      countedQty: 10,
      reason: "闭店盘点"
    },
    transferForm: {
      skuIndex: 0,
      quantity: 1
    },
    storageLedgers: [],
    finance: {},
    businessDetails: [],
    consumptionRecords: [],
    memberLevels: [],
    pointsConfig: {},
    memberLevelForm: {
      name: "黑金会员",
      minPoints: 2000
    },
    pointsConfigForm: {
      checkinPoints: 12,
      pointExpireDays: 180,
      pointsVisible: true,
      checkinEnabled: true
    },
    scanRecords: [],
    systemSettings: {},
    systemSettingsForm: {
      supportPhone: "021-88886666",
      pointsVisible: true,
      locationAddress: "上海市静安区示例路 88 号",
      latitude: 31.2304,
      longitude: 121.4737
    },
    employeeForm: {
      name: "新员工",
      phone: "13900009999",
      loginAccount: "newstaff",
      password: "demo123",
      role: "staff",
      commissionRate: 0.05
    },
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
      autoStartAfterCountdown: true,
      levelTitle: "LEVEL",
      playerLeftTitle: "PLAYER LEFT",
      blindsTitle: "BLINDS",
      entrantsTitle: "ENTRANTS",
      smallBlindTerm: "小盲",
      bigBlindTerm: "大盲",
      anteTerm: "前注",
      blindLevelsText: "1/2,2/4,5/10,10/20,25/50,50/100"
    },
    categoryForm: {
      name: "软饮",
      sortOrder: 4
    },
    productForm: {
      editingSkuId: "",
      categoryIndex: 0,
      name: "气泡水",
      spec: "330ml",
      unit: "瓶",
      description: "清爽无糖气泡水",
      price: 18,
      costPrice: 8,
      supplierName: "默认供应商",
      stockQty: 12,
      warningQty: 2,
      storageDays: 30
    },
    tableForm: {
      name: "B2 新桌",
      type: "普通卡座",
      capacity: 9,
      imageUrl: "https://dummyimage.com/640x360/183026/f4d9a6&text=Poker+Table"
    },
    tableOccupyForm: {
      consumptionAmount: 0,
      reason: "后台开台"
    }
  },

  onShow() {
    this.loadAll()
  },

  onLoginAccount(event) {
    this.setData({ loginAccount: event.detail.value })
  },

  onLoginPassword(event) {
    this.setData({ loginPassword: event.detail.value })
  },

  async adminLogin() {
    try {
      const data = await request("/api/staff/login", { method: "POST", data: { account: this.data.loginAccount, password: this.data.loginPassword } })
      if (data.employee.role !== "admin") throw new Error("当前账号不是管理员")
      app.globalData.staffSessionId = data.session.sessionId
      app.globalData.selectedEmployeeId = data.employee.employeeId
      this.setData({ loginSession: data.session })
      wx.showToast({ title: "登录成功" })
      await this.loadAll()
    } catch (error) {
      showError(error)
    }
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
      },
      staffSales: (data.staffSales || []).map((item) => ({
        ...item,
        salesText: money(item.sales),
        commissionText: money(item.commissionAmount),
        commissionRateText: `${Math.round(item.commissionRate * 10000) / 100}%`
      }))
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
    const [finance, business, consumptionRecords, users, levels, pointsConfig, stockRequests, stockLedgers, stockCounts, storageLedgers, scanRecords, system, blind] = await Promise.all([
      request("/api/admin/finance/overview"),
      request("/api/admin/business-details"),
      request("/api/admin/consumption-records"),
      request("/api/admin/users"),
      request("/api/admin/member-levels"),
      request("/api/admin/points-config"),
      request("/api/admin/stock-requests"),
      request("/api/admin/stock-ledgers"),
      request("/api/admin/stock-counts"),
      request("/api/admin/storage-ledgers"),
      request("/api/admin/scan-records"),
      request("/api/admin/system-settings"),
      request("/api/admin/blind-settings")
    ])
    this.setData({
      finance: {
        ...finance,
        todayRevenueText: money(finance.todayRevenue),
        monthRevenueText: money(finance.monthRevenue),
        wechatPayRevenueText: money(finance.wechatPayRevenue)
      },
      businessDetails: business.details,
      users: users.users.map((item) => ({ ...item, totalSpendText: money(item.totalSpend) })),
      consumptionRecords: consumptionRecords.records.map((item) => ({ ...item, amountText: money(item.amount), statusText: statusText(item.orderStatus) })),
      memberLevels: levels.levels,
      pointsConfig: pointsConfig.config,
      pointsConfigForm: {
        checkinPoints: pointsConfig.config.checkinPoints,
        pointExpireDays: pointsConfig.config.pointExpireDays,
        pointsVisible: pointsConfig.config.pointsVisible,
        checkinEnabled: pointsConfig.config.checkinEnabled
      },
      stockRequests: stockRequests.requests.map((item) => ({ ...item, statusText: statusText(item.status), directionText: item.direction === "in" ? "入库" : "出库" })),
      stockLedgers: stockLedgers.ledgers.slice(0, 8),
      stockCounts: stockCounts.counts.slice(0, 8),
      storageLedgers: storageLedgers.ledgers.slice(0, 8).map((item) => ({ ...item, productName: item.product ? item.product.name : item.skuId, userPhone: item.user ? item.user.phone : item.userId })),
      scanRecords: scanRecords.records.slice(0, 8),
      systemSettings: system.settings,
      systemSettingsForm: {
        supportPhone: system.settings.supportPhone,
        pointsVisible: system.settings.pointsVisible,
        locationAddress: system.settings.location ? system.settings.location.address : "",
        latitude: system.settings.location ? system.settings.location.latitude : 0,
        longitude: system.settings.location ? system.settings.location.longitude : 0
      },
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
        anteTerm: blind.settings.voiceTerms?.ante || this.data.blindForm.anteTerm,
        blindLevelsText: (blind.settings.blindLevels || []).map((level) => `${level.smallBlind}/${level.bigBlind}${level.ante ? `/${level.ante}` : ""}`).join(",")
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
      const sku = this.data.products[this.data.transferForm.skuIndex] || this.data.products[0]
      if (!sku) throw new Error("请先选择转存 SKU")
      await request(`/api/admin/orders/${event.currentTarget.dataset.id}/transfer-storage`, {
        method: "POST",
        data: { skuId: sku.skuId, quantity: this.data.transferForm.quantity, operatorId: "emp_admin" }
      })
      wx.showToast({ title: "已转存" })
      await this.loadStorage()
    } catch (error) {
      showError(error)
    }
  },

  onTransferSkuChange(event) {
    this.setData({ "transferForm.skuIndex": Number(event.detail.value) })
  },

  onTransferQty(event) {
    this.setData({ "transferForm.quantity": Number(event.detail.value || 1) })
  },

  async addStock(event) {
    try {
      await request("/api/admin/stock-counts", {
        method: "POST",
        data: {
          skuId: event.currentTarget.dataset.id,
          countedQty: this.data.stockCountForm.countedQty,
          reason: this.data.stockCountForm.reason,
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "盘点已入账" })
      await this.loadProducts()
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  onStockCountQty(event) {
    this.setData({ "stockCountForm.countedQty": Number(event.detail.value || 0) })
  },

  onStockCountReason(event) {
    this.setData({ "stockCountForm.reason": event.detail.value })
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

  onProductSpec(event) {
    this.setData({ "productForm.spec": event.detail.value })
  },

  onProductUnit(event) {
    this.setData({ "productForm.unit": event.detail.value })
  },

  onProductDescription(event) {
    this.setData({ "productForm.description": event.detail.value })
  },

  onProductPrice(event) {
    this.setData({ "productForm.price": Number(event.detail.value || 0) })
  },

  onProductCost(event) {
    this.setData({ "productForm.costPrice": Number(event.detail.value || 0) })
  },

  onProductSupplier(event) {
    this.setData({ "productForm.supplierName": event.detail.value })
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

  onCategoryName(event) {
    this.setData({ "categoryForm.name": event.detail.value })
  },

  onCategorySortOrder(event) {
    this.setData({ "categoryForm.sortOrder": Number(event.detail.value || 0) })
  },

  async createCategory() {
    try {
      await request("/api/admin/categories", { method: "POST", data: { ...this.data.categoryForm, operatorId: "emp_admin" } })
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
          spec: this.data.productForm.spec,
          unit: this.data.productForm.unit,
          price: this.data.productForm.price,
          costPrice: this.data.productForm.costPrice,
          supplierName: this.data.productForm.supplierName,
          stockQty: this.data.productForm.stockQty,
          warningQty: this.data.productForm.warningQty,
          description: this.data.productForm.description,
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

  fillProductForm(event) {
    const product = this.data.products.find((item) => item.skuId === event.currentTarget.dataset.id)
    if (!product) return
    const categoryIndex = Math.max(0, this.data.productCategories.findIndex((item) => item.categoryId === product.categoryId))
    this.setData({
      productForm: {
        editingSkuId: product.skuId,
        categoryIndex,
        name: product.name,
        spec: product.spec,
        unit: product.unit,
        description: product.description || "",
        price: product.price,
        costPrice: product.costPrice,
        supplierName: product.supplierName,
        stockQty: product.stockQty,
        warningQty: product.warningQty,
        storageDays: product.storageDays
      }
    })
  },

  async updateProduct() {
    try {
      if (!this.data.productForm.editingSkuId) throw new Error("请先选择要编辑的 SKU")
      const category = this.data.productCategories[this.data.productForm.categoryIndex] || this.data.productCategories[0]
      await request(`/api/admin/products/${this.data.productForm.editingSkuId}`, {
        method: "PATCH",
        data: {
          categoryId: category.categoryId,
          name: this.data.productForm.name,
          spec: this.data.productForm.spec,
          unit: this.data.productForm.unit,
          price: this.data.productForm.price,
          costPrice: this.data.productForm.costPrice,
          supplierName: this.data.productForm.supplierName,
          warningQty: this.data.productForm.warningQty,
          description: this.data.productForm.description,
          storageDays: this.data.productForm.storageDays,
          reason: "后台 SKU 表单编辑",
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "SKU 已保存" })
      await this.loadProducts()
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
        data: {
          skuId: event.currentTarget.dataset.id,
          direction: event.currentTarget.dataset.direction,
          quantity: this.data.stockRequestForm.quantity,
          reason: this.data.stockRequestForm.reason,
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "申请已提交" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  onStockRequestQty(event) {
    this.setData({ "stockRequestForm.quantity": Number(event.detail.value || 0) })
  },

  onStockRequestReason(event) {
    this.setData({ "stockRequestForm.reason": event.detail.value })
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

  async cancelStockRequest(event) {
    try {
      await request(`/api/admin/stock-requests/${event.currentTarget.dataset.id}/cancel`, { method: "POST", data: { operatorId: "emp_admin", reason: "后台取消" } })
      wx.showToast({ title: "已取消" })
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
  async cancelAdminReservation(event) {
    try {
      await request(`/api/admin/reservations/${event.currentTarget.dataset.id}`, {
        method: "PATCH",
        data: { status: "cancelled", reason: "小程序后台取消预约" }
      })
      wx.showToast({ title: "已取消" })
      await this.loadReservations()
      await this.loadTables()
    } catch (error) {
      showError(error)
    }
  },

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

  onTableImage(event) {
    this.setData({ "tableForm.imageUrl": event.detail.value })
  },

  onTableOccupyAmount(event) {
    this.setData({ "tableOccupyForm.consumptionAmount": Number(event.detail.value || 0) })
  },

  onTableOccupyReason(event) {
    this.setData({ "tableOccupyForm.reason": event.detail.value })
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
      await request(`/api/admin/tables/${event.currentTarget.dataset.id}`, {
        method: "PATCH",
        data: {
          status: "occupied",
          consumptionAmount: this.data.tableOccupyForm.consumptionAmount,
          reason: this.data.tableOccupyForm.reason,
          operatorId: "emp_admin"
        }
      })
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

  async deleteTable(event) {
    try {
      await request(`/api/admin/tables/${event.currentTarget.dataset.id}`, { method: "DELETE", data: { operatorId: "emp_admin", reason: "小程序后台删除座台" } })
      wx.showToast({ title: "座台已禁用" })
      await this.loadTables()
      await this.loadDashboard()
    } catch (error) {
      showError(error)
    }
  },

  async createMemberLevel() {
    try {
      await request("/api/admin/member-levels", {
        method: "POST",
        data: {
          name: this.data.memberLevelForm.name,
          minPoints: this.data.memberLevelForm.minPoints,
          status: "active"
        }
      })
      wx.showToast({ title: "已新增等级" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  onMemberLevelName(event) {
    this.setData({ "memberLevelForm.name": event.detail.value })
  },

  onMemberLevelMinPoints(event) {
    this.setData({ "memberLevelForm.minPoints": Number(event.detail.value || 0) })
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
      await request("/api/admin/points-config", {
        method: "PATCH",
        data: {
          checkinPoints: this.data.pointsConfigForm.checkinPoints,
          pointExpireDays: this.data.pointsConfigForm.pointExpireDays,
          pointsVisible: this.data.pointsConfigForm.pointsVisible,
          checkinEnabled: this.data.pointsConfigForm.checkinEnabled,
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "积分配置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  onCheckinPoints(event) {
    this.setData({ "pointsConfigForm.checkinPoints": Number(event.detail.value || 0) })
  },

  onPointExpireDays(event) {
    this.setData({ "pointsConfigForm.pointExpireDays": Number(event.detail.value || 0) })
  },

  onPointsVisibleChange(event) {
    this.setData({ "pointsConfigForm.pointsVisible": Boolean(event.detail.value) })
  },

  onCheckinEnabledChange(event) {
    this.setData({ "pointsConfigForm.checkinEnabled": Boolean(event.detail.value) })
  },

  async createEmployee() {
    try {
      await request("/api/admin/employees", {
        method: "POST",
        data: {
          name: this.data.employeeForm.name,
          phone: this.data.employeeForm.phone,
          loginAccount: this.data.employeeForm.loginAccount,
          password: this.data.employeeForm.password,
          role: this.data.employeeForm.role,
          commissionRate: this.data.employeeForm.commissionRate,
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "已新增员工" })
      await this.loadDashboard()
    } catch (error) {
      showError(error)
    }
  },

  onEmployeeName(event) {
    this.setData({ "employeeForm.name": event.detail.value })
  },

  onEmployeePhone(event) {
    this.setData({ "employeeForm.phone": event.detail.value })
  },

  onEmployeeLoginAccount(event) {
    this.setData({ "employeeForm.loginAccount": event.detail.value })
  },

  onEmployeePassword(event) {
    this.setData({ "employeeForm.password": event.detail.value })
  },

  onEmployeeRole(event) {
    this.setData({ "employeeForm.role": event.detail.value })
  },

  onEmployeeCommissionRate(event) {
    this.setData({ "employeeForm.commissionRate": Number(event.detail.value || 0) })
  },

  async updateSystemSettings() {
    try {
      await request("/api/admin/system-settings", {
        method: "PATCH",
        data: {
          pointsVisible: this.data.systemSettingsForm.pointsVisible,
          supportPhone: this.data.systemSettingsForm.supportPhone,
          location: {
            latitude: this.data.systemSettingsForm.latitude,
            longitude: this.data.systemSettingsForm.longitude,
            address: this.data.systemSettingsForm.locationAddress
          },
          operatorId: "emp_admin"
        }
      })
      wx.showToast({ title: "系统设置已更新" })
      await this.loadV3Admin()
    } catch (error) {
      showError(error)
    }
  },

  onSystemSupportPhone(event) {
    this.setData({ "systemSettingsForm.supportPhone": event.detail.value })
  },

  onSystemLocationAddress(event) {
    this.setData({ "systemSettingsForm.locationAddress": event.detail.value })
  },

  onSystemLatitude(event) {
    this.setData({ "systemSettingsForm.latitude": Number(event.detail.value || 0) })
  },

  onSystemLongitude(event) {
    this.setData({ "systemSettingsForm.longitude": Number(event.detail.value || 0) })
  },

  onSystemPointsVisibleChange(event) {
    this.setData({ "systemSettingsForm.pointsVisible": Boolean(event.detail.value) })
  },

  onBlindField(event) {
    const key = event.currentTarget.dataset.key
    const numericKeys = ["fontSize", "entrants", "totalBuyins"]
    const value = numericKeys.includes(key) ? Number(event.detail.value || 0) : event.detail.value
    this.setData({ [`blindForm.${key}`]: value })
  },

  onBlindAutoStartChange(event) {
    this.setData({ "blindForm.autoStartAfterCountdown": Boolean(event.detail.value) })
  },

  async updateBlindSettings() {
    try {
      const form = this.data.blindForm
      const blindLevels = String(form.blindLevelsText || "")
        .split(",")
        .map((item, index) => {
          const [smallBlind, bigBlind, ante] = item.trim().split("/").map((value) => Number(value || 0))
          return { level: index + 1, smallBlind, bigBlind, ante: ante || 0 }
        })
        .filter((item) => item.smallBlind > 0 && item.bigBlind > 0)
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
          autoStartAfterCountdown: form.autoStartAfterCountdown,
          blindLevels,
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
