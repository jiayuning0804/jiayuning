/**
 * 体竞游IP合作推荐工具 — 后端代理服务
 *
 * 功能：
 *   1. 双模型支持：Friday（主，免费额度）+ DeepSeek（备用）
 *   2. 自动 fallback：Friday 失败时自动切换 DeepSeek
 *   3. 代理转发前端请求，隐藏所有 API Key / AppID
 *   4. 托管前端静态文件（./public 目录）
 *   5. 请求频率限制、输入校验、错误脱敏
 */

// dotenv 仅在本地开发时加载（Vercel 通过平台注入环境变量）
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

// ============================================================
// 配置 & 校验
// ============================================================

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Friday 配置（主）
const FRIDAY_APP_ID = process.env.FRIDAY_APP_ID;
const FRIDAY_API_URL = 'https://aigc.sankuai.com/v1/openai/native/chat/completions';
const FRIDAY_MODEL = process.env.FRIDAY_MODEL || 'deepseek-v3.2-meituan';

// DeepSeek 配置（备）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

// 请求超时时间（毫秒）
const REQUEST_TIMEOUT_MS = 60_000;
// 单条 message 内容最大长度
const MAX_MESSAGE_CONTENT_LENGTH = 10_000;
// messages 数组最大长度
const MAX_MESSAGES_COUNT = 50;

// 至少需要配置一个模型
if (!FRIDAY_APP_ID && !DEEPSEEK_API_KEY) {
  console.error('[警告] 未配置任何模型：请设置 FRIDAY_APP_ID 或 DEEPSEEK_API_KEY');
}

// ============================================================
// Express 应用初始化
// ============================================================

const app = express();

// ---------- 请求体大小限制（100KB） ----------
app.use(express.json({ limit: '100kb' }));

// ---------- 请求日志中间件 ----------
app.use((req, _res, next) => {
  const start = Date.now();
  const ip = req.ip || req.socket.remoteAddress;

  _res.on('finish', () => {
    const duration = Date.now() - start;
    const now = new Date().toISOString();
    console.log(`[${now}] ${req.method} ${req.originalUrl} - ${_res.statusCode} - ${ip} - ${duration}ms`);
  });

  next();
});

// ---------- 频率限制：每个 IP 每分钟最多 10 次 ----------
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
  keyGenerator: (req) => req.ip || req.socket.remoteAddress,
});

// ============================================================
// 模型调用函数
// ============================================================

/**
 * 调用单个模型 API
 * @returns {Promise<object>} 成功返回 { ok: true, data }，失败返回 { ok: false, status, error }
 */
async function callModel({ url, headers, body, label }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errBody = await response.json();
        errorDetail = JSON.stringify(errBody);
      } catch {
        errorDetail = await response.text().catch(() => '');
      }
      console.error(`[${label} 错误] status=${response.status} detail=${errorDetail}`);
      return { ok: false, status: response.status, error: errorDetail };
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error(`[${label} 异常] 响应结构异常:`, JSON.stringify(data).slice(0, 500));
      return { ok: false, status: 502, error: '响应结构异常' };
    }

    return { ok: true, data };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[${label} 超时] 请求超过 ${REQUEST_TIMEOUT_MS}ms`);
      return { ok: false, status: 504, error: '请求超时' };
    }
    console.error(`[${label} 网络错误]`, err.message);
    return { ok: false, status: 502, error: err.message };
  }
}

/** 调用 Friday */
function callFriday(requestBody) {
  return callModel({
    url: FRIDAY_API_URL,
    headers: { 'Authorization': `Bearer ${FRIDAY_APP_ID}` },
    body: { ...requestBody, model: requestBody.model || FRIDAY_MODEL },
    label: 'Friday',
  });
}

/** 调用 DeepSeek */
function callDeepSeek(requestBody) {
  return callModel({
    url: DEEPSEEK_API_URL,
    headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
    body: { ...requestBody, model: DEEPSEEK_MODEL },
    label: 'DeepSeek',
  });
}

// ============================================================
// API 路由：POST /api/chat
// ============================================================

app.post('/api/chat', apiLimiter, async (req, res) => {
  try {
    // ---------- 输入校验 ----------
    const { messages, model, temperature, max_tokens, response_format } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 参数必须是数组' });
    }
    if (messages.length === 0) {
      return res.status(400).json({ error: 'messages 不能为空' });
    }
    if (messages.length > MAX_MESSAGES_COUNT) {
      return res.status(400).json({ error: `messages 数量不能超过 ${MAX_MESSAGES_COUNT}` });
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object') {
        return res.status(400).json({ error: `messages[${i}] 格式无效` });
      }
      if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: `messages[${i}].role 只能是 system/user/assistant` });
      }
      if (typeof msg.content !== 'string') {
        return res.status(400).json({ error: `messages[${i}].content 必须是字符串` });
      }
      if (msg.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
        return res.status(400).json({ error: `messages[${i}].content 长度不能超过 ${MAX_MESSAGE_CONTENT_LENGTH}` });
      }
    }

    // ---------- 构建请求体 ----------
    const requestBody = {
      messages,
      temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 2) : 0.3,
      max_tokens: typeof max_tokens === 'number' ? Math.min(Math.max(max_tokens, 1), 4096) : 2000,
    };
    // 支持 response_format
    if (response_format && response_format.type) {
      requestBody.response_format = response_format;
    }

    // ---------- 双模型调用策略：DeepSeek 优先，失败 fallback Friday ----------
    let result = null;
    let usedProvider = '';

    if (DEEPSEEK_API_KEY) {
      result = await callDeepSeek(requestBody);
      usedProvider = 'DeepSeek';
    }

    // DeepSeek 失败或未配置 → 尝试 Friday
    if ((!result || !result.ok) && FRIDAY_APP_ID) {
      if (result) {
        console.log(`[Fallback] DeepSeek 失败(${result.status})，切换到 Friday`);
      }
      result = await callFriday(requestBody);
      usedProvider = 'Friday';
    }

    // 两个都没配置或都失败
    if (!result || !result.ok) {
      const status = result ? (result.status >= 500 ? 502 : result.status) : 503;
      const clientMessages = {
        400: 'AI 请求参数有误',
        401: 'AI 服务认证失败，请联系管理员',
        402: 'AI 服务额度不足',
        429: 'AI 服务请求过于频繁，请稍后重试',
        502: 'AI 服务暂时不可用，请稍后重试',
        503: 'AI 服务暂时不可用，请稍后重试',
        504: 'AI 服务响应超时，请稍后重试',
      };
      return res.status(status).json({ error: clientMessages[status] || 'AI 服务异常，请稍后重试' });
    }

    // 成功响应
    console.log(`[成功] 使用 ${usedProvider} 响应`);
    res.json({
      choices: [{
        message: {
          role: result.data.choices[0].message.role,
          content: result.data.choices[0].message.content,
        },
      }],
      usage: result.data.usage || null,
      provider: usedProvider, // 让前端知道用的哪个模型（可选）
    });

  } catch (err) {
    console.error('[未知错误]', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ============================================================
// 健康检查接口
// ============================================================

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    providers: {
      friday: FRIDAY_APP_ID ? '已配置' : '未配置',
      deepseek: DEEPSEEK_API_KEY ? '已配置' : '未配置',
    },
    primaryModel: DEEPSEEK_API_KEY ? `DeepSeek (${DEEPSEEK_MODEL})` : `Friday (${FRIDAY_MODEL})`,
  });
});

// ============================================================
// 静态文件托管（前端页面）
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// 启动服务（仅本地开发时执行，Vercel Serverless 不需要 listen）
// ============================================================

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`[启动成功] 代理服务运行在 http://localhost:${PORT}`);
    console.log(`[模型配置]`);
    if (FRIDAY_APP_ID) {
      console.log(`  ✅ Friday（备）: ${FRIDAY_APP_ID.slice(0, 6)}...${FRIDAY_APP_ID.slice(-4)} | 模型: ${FRIDAY_MODEL}`);
    } else {
      console.log(`  ⚠️ Friday: 未配置`);
    }
    if (DEEPSEEK_API_KEY) {
      console.log(`  ✅ DeepSeek（主）: ${DEEPSEEK_API_KEY.slice(0, 6)}...${DEEPSEEK_API_KEY.slice(-4)}`);
    } else {
      console.log(`  ⚠️ DeepSeek: 未配置`);
    }
    console.log(`[策略] DeepSeek 优先 → 失败自动切换 Friday`);
  });
}

// 导出 app 供 Vercel Serverless 使用
module.exports = app;
