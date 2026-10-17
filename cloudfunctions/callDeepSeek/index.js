const https = require('../streamDeepSeek_old/node_modules/https');

exports.main = async (event, context) => {
  const deepseekApiKey = 'sk-你的DeepSeek官方Key'; // ⚠️ 这里填你的Key
  
  const history = event.history || [];
  const recentHistory = history.slice(-10).map(item => ({
    role: item.role,
    content: item.content
  }));

  const messages = [
    // 强制它少说废话，这样 3 秒内肯定能回复完
    { role: "system", content: "你是一个乐于助人的个人助手，回答要简明扼要。请务必使用流畅、标准的中文回答，绝对不要出现重复字词或结巴。" },
    ...recentHistory,
    { role: "user", content: event.message || "你好" }
  ];

  return new Promise((resolve, reject) => {
    // 🎯 就是这段，我把 max_tokens 加在这里了！
    const postData = JSON.stringify({
      model: "deepseek-chat",
      messages: messages,
      max_tokens: 300 // 限制AI最多吐300个字，3秒内绝对能说完，绝对不会超时！
    });

    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + deepseekApiKey.trim(),
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
};