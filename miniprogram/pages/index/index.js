let typeTimer = null;
let transitionTimer = null;
const db = wx.cloud.database(); // 初始化云数据库

Page({
  data: {
    currentView: 'home',
    agentType: 'old',
    chatList: [],
    inputValue: "",
    scrollToView: "",
    isLoading: false,
    isTransitioning: false
  },
   onLoad() {
    const db = wx.cloud.database();
    const _ = db.command;

    // 1. 先查出当前用户所有的历史记录（拿到 _id）
    db.collection('chat_history').get().then(res => {
      const ids = res.data.map(item => item._id);
      
      // 2. 如果压根没记录，直接跳过
      if (ids.length === 0) return;

      // 3. 根据查到的 _id 批量删除（这样就符合了微信的安全要求）
      db.collection('chat_history').where({
        _id: _.in(ids)
      }).remove()
        .then(() => {
          console.log("小程序启动，记忆已自动清空，删除了", ids.length, "条记录");
        })
        .catch(err => {
          console.error("启动清空失败", err);
        });
    }).catch(err => {
      console.error("查询记录失败", err);
    });
  },
  // ================= 1. 进入聊天 =================
  enterChat(e) {
    const type = e.currentTarget.dataset.type;
    
    if (typeTimer) clearInterval(typeTimer);
    if (transitionTimer) clearTimeout(transitionTimer);

    // 开启转场动画
    this.setData({ isTransitioning: true });

    transitionTimer = setTimeout(() => {
      this.setData({
        currentView: 'chat',
        agentType: type,
        isTransitioning: false,
        chatList: [], 
        inputValue: ""
      }, () => {
        // 动画结束，去云端拉取该人格的历史记忆
        this.loadHistory(type);
      });
    }, 600); 
  },

  // ================= 2. 读取长期记忆 =================
   loadHistory(agentType) {
    wx.showLoading({ title: '唤醒记忆中...' });
    
    db.collection('chat_history')
      .where({ agentType: agentType })
      .orderBy('timestamp', 'asc') // 按时间先后顺序
      .limit(20) // 最多取最近20条，防止太长超Token
      .get()
      .then(res => {
        wx.hideLoading();
        if (res.data.length > 0) {
          // 有记忆：恢复聊天记录
          const historyList = res.data.map(item => ({
            role: item.role,
            content: item.content,
            htmlContent: this.formatMarkdown(item.content)
          }));
          
          this.setData({
            chatList: historyList,
            scrollToView: `msg-${historyList.length - 1}`
          });
        } else {
          // 没记忆：播放开场白
          let text = agentType === 'old' 
            ? "龙江风光无限好，常青陪您慢慢走，有什么问题随时问我~" 
            : "龙江有不少好玩的，想去哪玩儿，新芽队长带你！";
          this.playWelcome(text);
        }
      })
      .catch(err => {
        wx.hideLoading();
        console.error("读取记忆失败", err);
      });
  },

  // ================= 3. 保存单条记忆 =================
  saveMessage(role, content) {
    db.collection('chat_history').add({
      data: {
        agentType: this.data.agentType, 
        role: role,                     
        content: content,               
        timestamp: new Date().getTime() 
      }
    }).catch(err => console.error("保存记忆失败", err));
  },

  // ================= 4. 返回首页 =================
  goBack() {
    if (typeTimer) clearInterval(typeTimer);
    if (transitionTimer) clearTimeout(transitionTimer);
    this.setData({ currentView: 'home', chatList: [], inputValue: "", isLoading: false, isTransitioning: false });
  },

  // ================= 5. 播放开场白 =================
  playWelcome(text) {
    if (typeTimer) clearInterval(typeTimer);
    const arr = Array.from(text);
    let i = 0;

    typeTimer = setInterval(() => {
      i++;
      let current = arr.slice(0, i).join('');
      this.setData({
        chatList: [{ role: 'assistant', content: current, htmlContent: current.replace(/\n/g, '<br/>') }]
      });
      if (i >= arr.length) {
        clearInterval(typeTimer);
        // 开场白打完后，也存入记忆
        this.saveMessage('assistant', text);
      }
    }, 40);
  },

  // ================= 6. 处理输入 =================
  onInput(e) { 
    this.setData({ inputValue: e.detail.value }); 
  },

  formatMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return html;
  },

  // ================= 7. 发送消息 (核心：RAG + 记忆 + 流式) =================
  async sendMessage() {
    const msg = this.data.inputValue.trim();
    if (!msg || this.data.isLoading) return;
    
    if (typeTimer) clearInterval(typeTimer); 

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

    // 🎯 1. 先把用户的话存进长期记忆
    this.saveMessage('user', msg);

    // 🎯 2. 去知识库搜刮相关的干货
    let retrievedText = "";
    try {
      const dbRes = await db.collection('knowledge')
        .where({
          agentType: this.data.agentType,
          // 简单粗暴的正则模糊匹配（只要包含用户输入的部分字眼就查出来）
          content: db.RegExp({ regexp: msg, options: 'i' }) 
        })
        .limit(2) // 最多取2段资料，防止太长
        .get();
        
      if (dbRes.data.length > 0) {
        retrievedText = dbRes.data.map(item => item.content).join('\n\n');
      }
    } catch (e) {
      console.warn("知识库查询失败", e);
    }

    // 🎯 3. 组装高级 Prompt（包含人设 + 知识库资料）
    let basePrompt = this.data.agentType === 'old' 
      ? "你是黑龙江适老化伴游的“慢路线调度员”：帮老人把行程拆短，标出沿途休息点、卫生间和无障碍入口，提醒天气穿衣，一键叫车、联系家人，语音大字少步骤。它不承诺陪聊陪护，只把伴游里最容易累、最容易乱的那几件事接住。" 
      : "你是儿童友好伴游的“小任务领队”：把景点讲解变成边走边找的小任务，标出厕所、母婴室和能歇脚的地方，控制节奏，提醒防走失，让家长能看行程。它不替家长看孩子，只把“孩子走不动、没兴趣、找厕所”这些事提前接住。";

    let systemPrompt = basePrompt;
    if (retrievedText) {
      systemPrompt += `\n\n【重要参考知识】\n请优先根据以下资料回答用户，如果资料没有提及，再用你的常识回答：\n${retrievedText}`;
    }

    let fullText = "";

    // 🎯 4. 发起流式请求
    const requestTask = wx.request({
      url: 'https://api.deepseek.com/v1/chat/completions',
      method: 'POST',
      timeout: 60000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-9d0a0a1ee8c0407bbdd8f19cccc1484a' // ⚠️ 换成你的 DeepSeek Key
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
      
      // 请求结束时，把 AI 的回答存进记忆
      complete: () => {
        this.setData({ isLoading: false });
        if (fullText) {
          this.saveMessage('assistant', fullText);
        }
      },
      fail: () => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });

    // 接收流式文字
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
});