const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ⚠️ 强烈建议在云开发控制台把 Key 配到环境变量里，这里为了演示先写死
const DEEPSEEK_API_KEY = 'sk-你的Key写在这里';

exports.main = async (event, context) => {
  const { message, agentType } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID; // 拿到当前用户的唯一标识

  // 1. 去知识库检索（简单版正则匹配）
  let retrievedText = "";
  try {
    const kbRes = await db.collection('knowledge').where({
      agentType: agentType,
      content: db.RegExp({ regexp: message, options: 'i' })
    }).limit(2).get();
    
    if (kbRes.data.length > 0) {
      retrievedText = kbRes.data.map(item => item.content).join('\n\n');
    }
  } catch (e) { console.log("知识库查询失败", e); }

  // 2. 组装 Prompt
  let basePrompt = agentType === 'old' 
    ? "你是一位经验丰富的老者，说话沉稳。" 
    : "你是一个充满活力的年轻人，说话幽默。";
  
  let systemPrompt = basePrompt;
  if (retrievedText) {
    systemPrompt += `\n\n【重要参考知识】\n${retrievedText}`;
  }

  // 3. 获取历史记忆 (比如最近10条)
  let historyMessages = [];
  try {
    const historyRes = await db.collection('chat_history')
      .where({ agentType: agentType, _openid: openid })
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
      
    // 因为查出来是倒序的，要翻转为正序
    historyMessages = historyRes.data.reverse().map(item => ({
      role: item.role,
      content: item.content
    }));
  } catch (e) { console.log("记忆拉取失败", e); }

  // 4. 组装最终发给大模型的消息
  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: message }
  ];

  // 5. 为了让前端能接流式，这里返回给前端的其实是个“配置”，真正的请求前端去发（或者用云函数流式推）
  // 但为了安全起见，如果是参赛演示，最核心的是隐藏 Key 和知识库检索。
  // 为了方便你目前的前端改造成本最低，我们这里返回请求体，前端拿着这个请求体去发请求。
  return {
    success: true,
    requestBody: {
      model: "deepseek-chat",
      messages: messages,
      stream: true
    }
  };
};