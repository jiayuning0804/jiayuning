/**
 * common.js — 公共工具函数
 *
 * 从 app.js / admin.js 中抽取的共用函数，避免重复定义。
 * 在 HTML 中需要在 data.js 之后、app.js / admin.js 之前引入。
 *
 * 依赖：data.js（BUILTIN_LLM、DB）
 */

// ===== HTML转义（防 XSS）=====
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Toast提示（与 styles.css 中 .toast class 兼容）=====
function showToast(msg, type = '') {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  const duration = Math.max(2800, msg.length * 80);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== 防抖函数 =====
function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ===== 大模型 API 调用（通过后端代理，含 AbortController 超时）=====
async function callLLM(messages, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const config = DB.getConfig();
    const resp = await fetch(BUILTIN_LLM.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // 不再携带 Authorization header，API Key 由后端管理
      },
      body: JSON.stringify({
        model: config.model || BUILTIN_LLM.model,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `API请求失败 (${resp.status})`);
    }
    const data = await resp.json();
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时（30秒），请稍后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
