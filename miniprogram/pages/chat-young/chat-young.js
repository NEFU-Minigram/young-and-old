Page({
  data: {
    chatList: [],
    inputValue: "",
    scrollToView: "",
    isLoading: false
  },

  onReady() {
    wx.hideLoading(); 

    // 🎯 年轻人专属开场白
    let text = "Hey bro！👋 我在这儿呢！今天有什么好玩的或者想吐槽的？快跟我说说！😎";
    
    setTimeout(() => {
      this.playWelcomeGreeting(text);
    }, 200);
  },

  onUnload() {
    this.isDestroyed = true; 
    if (this.typeTimer) clearTimeout(this.typeTimer);
  },

  playWelcomeGreeting(fullText) {
    this.setData({
      chatList: [{ role: 'assistant', content: '', htmlContent: '' }]
    });

    const textArray = Array.from(fullText);
    let currentIndex = 0;

    const typeNext = () => {
      if (this.isDestroyed) return; 

      currentIndex += 1; 
      let currentText = textArray.slice(0, currentIndex).join('');
      
      this.setData({
        chatList: [{ 
          role: 'assistant', 
          content: currentText, 
          htmlContent: currentText.replace(/\n/g, '<br/>') 
        }]
      }, () => {
        if (currentIndex < textArray.length) {
          this.typeTimer = setTimeout(typeNext, 40);
        }
      });
    };

    this.typeTimer = setTimeout(typeNext, 40);
  },

  onInput(e) { this.setData({ inputValue: e.detail.value }); },
  
  formatMarkdown(text) {
    if (!text) return "";
    let html = text;
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\n/g, '<br/>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return html;
  },

  sendMessage() {
    const msg = this.data.inputValue.trim();
    if (!msg || this.data.isLoading) return;
    if (this.typeTimer) clearTimeout(this.typeTimer);

    const history = this.data.chatList;
    const newList = [...history, { role: 'user', content: msg }];
    const aiIndex = newList.length; 
    newList.push({ role: 'assistant', content: '', htmlContent: '' }); 

    this.setData({ chatList: newList, inputValue: "", isLoading: true, scrollToView: `msg-${aiIndex}` });

    let fullText = ""; 
    
    // 🎯 年轻人专属系统提示词
    let systemPrompt = "你是一个充满活力的年轻人，说话幽默、网络流行语不断，思维非常跳跃，回答时喜欢带点emoji。";

    const requestTask = wx.request({
      url: 'https://api.deepseek.com/v1/chat/completions',
      method: 'POST',
      timeout: 60000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-9d0a0a1ee8c0407bbdd8f19cccc1484a' // ⚠️ 换成你的 Key
      },
      data: {
        model: "deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }, ...history.slice(-10), { role: "user", content: msg }],
        stream: true
      },
      enableChunked: true,
      success: () => { this.setData({ isLoading: false }); },
      fail: (err) => { 
        console.error("请求失败", err);
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
              let currentList = this.data.chatList;
              currentList[aiIndex].content = fullText;
              currentList[aiIndex].htmlContent = html;
              this.setData({ chatList: currentList, scrollToView: `msg-${aiIndex}` });
            }
          } catch (e) {}
        }
      }
    });
  }
})