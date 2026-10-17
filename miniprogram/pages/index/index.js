Page({
  goToChat(e) {
    const type = e.currentTarget.dataset.type; 
    
    // 确保这里的路径和你的实际文件夹名字一模一样
    if (type === 'old') {
      wx.navigateTo({ url: '/pages/chat-old/chat-old' });
    } else {
      wx.navigateTo({ url: '/pages/chat-young/chat-young' });
    }
  }
})