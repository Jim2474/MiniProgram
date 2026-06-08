const { request, showError, money, statusText } = require("../../utils/api")

Page({
  data: {
    form: {
      smallBlind: 1,
      bigBlind: 2,
      intervalMinutes: 10,
      initialPlayers: 9,
      buyinAmount: 100
    },
    game: null,
    timer: null,
    voiceEvents: [],
    blindSettings: { titleMap: {} },
    seats: []
  },

  onShow() {
    this.loadGame()
  },

  async loadGame() {
    try {
      const data = await request("/api/staff/blind-games")
      const boot = await request("/api/bootstrap")
      const blind = await request("/api/admin/blind-settings")
      this.setData({
        game: this.decorateGame(data.games[0]),
        seats: (boot.seats || []).map((item) => ({ ...item, statusText: statusText(item.status) })),
        blindSettings: blind.settings
      })
    } catch (error) {
      showError(error)
    }
  },

  decorateGame(game) {
    if (!game) return null
    return {
      ...game,
      statusText: statusText(game.status),
      headsUpText: game.currentPlayers === 2 ? " · 单挑阶段" : "",
      buyinTotalText: money(game.buyinAmount * game.buyinCount)
    }
  },

  onInput(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: Number(event.detail.value || 0) })
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
      const data = await request(`/api/staff/blind-games/${this.data.game.gameId}`, {
        method: "PATCH",
        data: {
          operatorId: "emp_dealer",
          action: event.currentTarget.dataset.action
        }
      })
      this.setData({ game: this.decorateGame(data.game) })
      await this.loadTimer()
    } catch (error) {
      showError(error)
    }
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
        voiceEvents: data.timer.latestEvents || []
      })
    } catch (error) {
      showError(error)
    }
  }
})
