let timer = null; // 全局定时器

Page({
  data: {
    chatList: [],
    inputValue: "",
    scrollToView: "",
    isLoading: false,
    agentType: 'old' // 默认
  },

  onLoad(options) {
    wx.hideLoading(); // 保险：关掉加载圈

    // 1. 接收参数并强行锁定
    let type = options.type || 'old';
    
    // 2. 设定不同人格的文案
    let welcomeText = type === 'old' 
      ? "你好啊，年轻人。老夫在此，有什么困惑或者烦心事，尽管坐下与我慢慢道来。" 
      : "Hey bro！👋 我在这儿呢！今天有什么好玩的或者想吐槽的？快跟我说说！😎";
    
    wx.setNavigationBarTitle({ title: type === 'old' ? 'Old 助手' : 'Young 助手' });

    // 3. 把初始状态一次性塞入，并在 setData 回调里立刻打字
    this.setData({ 
      agentType: type,
      chatList: [{ role: 'assistant', content: '', htmlContent: '' }] 
    }, () => {
      this.playWelcome(welcomeText);
    });
  },

  onUnload() {
    if (timer) clearInterval(timer); // 离开页面清定时器
  },

  // 极简打字机
  playWelcome(text) {
    if (timer) clearInterval(timer);
    const arr = Array.from(text);
    let i = 0;
    
    timer = setInterval(() => {
      i++;
      let current = arr.slice(0, i).join('');
      this.setData({
        chatList: [{ role: 'assistant', content: current, htmlContent: current }]
      });
      if (i >= arr.length) clearInterval(timer);
    }, 40);
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  formatMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return html;
  },

  sendMessage() {
    const msg = this.data.inputValue.trim();
    if (!msg || this.data.isLoading) return;
    
    if (timer) clearInterval(timer); // 用户发消息立刻打断开场白

    const history = this.data.chatList;
    const newList = [...history, { role: 'user', content: msg }];
    const aiIndex = newList.length;
    newList.push({ role: 'assistant', content: '', htmlContent: '' });

    this.setData({
      chatList: newList,
      inputValue: "",
      isLoading: true,
      scrollToView: `msg-${aiIndex}`
    });

    let fullText = "";
    let systemPrompt = this.data.agentType === 'old' 
      ? "你是一位经验丰富的老者，说话沉稳、充满哲理。" 
      : "你是一个充满活力的年轻人，说话幽默、网络流行语不断。";

    const requestTask = wx.request({
      url: 'https://api.deepseek.com/v1/chat/completions',
      method: 'POST',
      timeout: 60000,
      header: {
        'Content-Type': 'application/json',
        // ⚠️ 换成你的 Key！
        'Authorization': 'Bearer sk-9d0a0a1ee8c0407bbdd8f19cccc1484a' 
      },
      data: {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...history.slice(-10),
          { role: "user", content: msg }
        ],
        stream: true
      },
      enableChunked: true,
      success: () => this.setData({ isLoading: false }),
      fail: () => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });

    requestTask.onChunkReceived((res) => {
      const uint8Array = new Uint8Array(res.data);
      let chunkStr = '';
      for (let i = 0; i < uint8Array.length; i++) chunkStr += String.fromCharCode(uint8Array[i]);
      try { chunkStr = decodeURIComponent(escape(chunkStr)); } catch (e) {}
      
      const lines = chunkStr.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              const html = this.formatMarkdown(fullText);
              let list = this.data.chatList;
              list[aiIndex].content = fullText;
              list[aiIndex].htmlContent = html;
              this.setData({ chatList: list, scrollToView: `msg-${aiIndex}` });
            }
          } catch (e) {}
        }
      }
    });
  }
})