Page({
  goToChat(e) {
    const agent = e.currentTarget.dataset.agent;
    wx.navigateTo({
      url: `/pages/chat/chat?agent=${agent}`
    });
  }
})