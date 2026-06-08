const { request, showError, money, statusText } = require("../../utils/api")

Page({
  data: {
    form: {
      smallBlind: 1,
      bigBlind: 2,
      intervalIndex: 2,
      intervalMinutes: 10,
      initialPlayers: 9,
      buyinAmount: 100,
      voiceEnabled: true
    },
    intervalOptions: [5, 8, 10, 12, 15, 20],
    game: null,
    timer: null,
    voiceEvents: [],
    blindSettings: { titleMap: {} },
    blindDisplayStyle: "",
    blindTitleStyle: "",
    blindTimerStyle: "",
    blindDialogStyle: "",
    beijingTimeText: "",
    registrationCountdownText: "",
    seats: []
  },

  onShow() {
    this.loadGame()
    this.updateClockText()
    this.clockTimer = setInterval(() => this.updateClockText(), 1000)
  },

  onHide() {
    if (this.clockTimer) clearInterval(this.clockTimer)
  },

  onUnload() {
    if (this.clockTimer) clearInterval(this.clockTimer)
  },

  async loadGame() {
    try {
      const data = await request("/api/staff/blind-games")
      const boot = await request("/api/bootstrap")
      const blind = await request("/api/staff/blind-settings")
      const game = this.decorateGame(data.games[0])
      const blindSettings = {
        ...blind.settings,
        blindLevelsText: (blind.settings.blindLevels || []).map((item) => `${item.smallBlind}/${item.bigBlind}${item.ante ? `/${item.ante}` : ""}`).join(" → ")
      }
      const blindStyles = this.buildBlindDisplayStyles(blindSettings)
      const intervalMinutes = game ? game.intervalMinutes : this.data.form.intervalMinutes
      const intervalIndex = Math.max(0, this.data.intervalOptions.indexOf(intervalMinutes))
      this.setData({
        game,
        "form.buyinAmount": game ? game.buyinAmount : this.data.form.buyinAmount,
        "form.intervalMinutes": intervalMinutes,
        "form.intervalIndex": intervalIndex,
        "form.voiceEnabled": game ? game.voiceEnabled !== false : this.data.form.voiceEnabled,
        seats: (boot.seats || []).map((item) => ({ ...item, statusText: statusText(item.status) })),
        blindSettings,
        ...blindStyles
      })
    } catch (error) {
      showError(error)
    }
  },

  buildBlindDisplayStyles(settings) {
    const fontSize = Math.max(24, Math.min(96, Number(settings.fontSize || 48)))
    const fontFamily = settings.fontFamily && settings.fontFamily !== "system" ? settings.fontFamily : "Arial, sans-serif"
    const fontColor = settings.fontColor || "#FFFFFF"
    const timerColor = settings.timerColor || "#F8D66D"
    const dialogColor = settings.dialogColor || "#15221B"
    const backgroundImage = settings.backgroundImage ? `background-image: linear-gradient(rgba(0,0,0,.48), rgba(0,0,0,.48)), url('${settings.backgroundImage}'); background-size: cover; background-position: center;` : ""
    return {
      blindDisplayStyle: `background-color: ${dialogColor}; color: ${fontColor}; font-family: ${fontFamily}; ${backgroundImage}`,
      blindTitleStyle: `color: ${fontColor}; font-size: ${fontSize}rpx; font-family: ${fontFamily};`,
      blindTimerStyle: `color: ${timerColor}; font-size: ${Math.max(28, fontSize - 4)}rpx; font-family: ${fontFamily};`,
      blindDialogStyle: `background-color: ${dialogColor}; color: ${fontColor};`
    }
  },

  decorateGame(game) {
    if (!game) return null
    return {
      ...game,
      statusText: statusText(game.status),
      headsUpText: game.currentPlayers === 2 ? " · 单挑阶段" : "",
      championText: game.currentPlayers === 1 ? " · 冠军产生" : "",
      isChampion: game.currentPlayers === 1,
      buyinTotalText: money(game.buyinAmount * game.buyinCount)
    }
  },

  updateClockText() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, "0")
    const mm = String(now.getMinutes()).padStart(2, "0")
    const ss = String(now.getSeconds()).padStart(2, "0")
    this.setData({ beijingTimeText: `${hh}:${mm}:${ss}` })
  },

  onInput(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: Number(event.detail.value || 0) })
  },

  onIntervalChange(event) {
    const intervalIndex = Number(event.detail.value || 0)
    this.setData({ "form.intervalIndex": intervalIndex, "form.intervalMinutes": this.data.intervalOptions[intervalIndex] || 10 })
  },

  onVoiceEnabledChange(event) {
    this.setData({ "form.voiceEnabled": Boolean(event.detail.value) })
  },

  async createGame() {
    try {
      const data = await request("/api/staff/blind-games", {
        method: "POST",
        data: {
          operatorId: "emp_dealer",
          ...this.data.form
        }
      })
      this.setData({ game: this.decorateGame(data.game) })
      await this.loadTimer()
      wx.showToast({ title: "已开始" })
    } catch (error) {
      showError(error)
    }
  },

  async gameAction(event) {
    if (!this.data.game) return
    try {
      const action = event.currentTarget.dataset.action
      const payload = {
        operatorId: "emp_dealer",
        action
      }
      if (action === "set_buyin_amount") payload.buyinAmount = this.data.form.buyinAmount
      const data = await request(`/api/staff/blind-games/${this.data.game.gameId}`, {
        method: "PATCH",
        data: payload
      })
      this.setData({ game: this.decorateGame(data.game) })
      await this.loadTimer()
      await this.loadSeats()
    } catch (error) {
      showError(error)
    }
  },

  async gameSeatAction(event) {
    if (!this.data.game) return
    try {
      const data = await request(`/api/staff/blind-games/${this.data.game.gameId}`, {
        method: "PATCH",
        data: {
          operatorId: "emp_dealer",
          action: event.currentTarget.dataset.action,
          seatNo: Number(event.currentTarget.dataset.seat)
        }
      })
      this.setData({ game: this.decorateGame(data.game) })
      await this.loadSeats()
      await this.loadTimer()
    } catch (error) {
      showError(error)
    }
  },

  async loadSeats() {
    const boot = await request("/api/bootstrap")
    this.setData({
      seats: (boot.seats || []).map((item) => ({ ...item, statusText: statusText(item.status) }))
    })
  },

  async loadTimer() {
    if (!this.data.game) return
    try {
      const data = await request(`/api/staff/blind-games/${this.data.game.gameId}/timer`)
      this.setData({
        game: this.decorateGame(data.game),
        timer: {
          ...data.timer,
          remainingText: `${Math.floor(data.timer.remainingSeconds / 60)}:${String(data.timer.remainingSeconds % 60).padStart(2, "0")}`
        },
        registrationCountdownText: `${Math.floor(data.timer.remainingSeconds / 60)}:${String(data.timer.remainingSeconds % 60).padStart(2, "0")}`,
        voiceEvents: data.timer.latestEvents || []
      })
    } catch (error) {
      showError(error)
    }
  }
})
