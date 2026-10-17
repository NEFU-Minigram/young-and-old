Page({
  data: {
    chatList: [],
    inputValue: "",
    scrollToView: "",
    isLoading: false
  },

  onReady() {
    // 🎯 强制删除可能残留的 loading，双重保险
    wx.hideLoading(); 

    let text = "你好啊，年轻人。老夫在此，有什么困惑或者烦心事，尽管坐下与我慢慢道来。";
    
    // 延迟 200 毫秒，等页面连底裤都穿好了再开始
    setTimeout(() => {
      this.playWelcomeGreeting(text);
    }, 200);
  },

  onUnload() {
    this.isDestroyed = true; // 标记页面已销毁
    if (this.typeTimer) clearTimeout(this.typeTimer);
  },

  playWelcomeGreeting(fullText) {
    // 先塞入空数据
    this.setData({
      chatList: [{ role: 'assistant', content: '', htmlContent: '' }]
    });

    const textArray = Array.from(fullText);
    let currentIndex = 0;

    // 🎯 核心：用递归 setTimeout 替换 setInterval
    const typeNext = () => {
      if (this.isDestroyed) return; // 如果用户退出了，立刻停止打字

      currentIndex += 1; 
      let currentText = textArray.slice(0, currentIndex).join('');
      
      this.setData({
        chatList: [{ 
          role: 'assistant', 
          content: currentText, 
          htmlContent: currentText.replace(/\n/g, '<br/>') 
        }]
      }, () => {
        // 🎯 渲染完成后的回调里，再决定要不要打下一个字
        if (currentIndex < textArray.length) {
          this.typeTimer = setTimeout(typeNext, 40);
        }
      });
    };

    // 启动打字
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
    // 如果直接发消息，把还没打完的字停掉
    if (this.typeTimer) clearTimeout(this.typeTimer);

    const history = this.data.chatList;
    const newList = [...history, { role: 'user', content: msg }];
    const aiIndex = newList.length; 
    newList.push({ role: 'assistant', content: '', htmlContent: '' }); 

    this.setData({ chatList: newList, inputValue: "", isLoading: true, scrollToView: `msg-${aiIndex}` });

    let fullText = ""; 
    let systemPrompt = "你是一位经验丰富的老者，说话沉稳、充满哲理，喜欢用长辈的口吻回答问题。";

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
      fail: (err) => { this.setData({ isLoading: false }); wx.showToast({ title: '网络错误', icon: 'none' }); }
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