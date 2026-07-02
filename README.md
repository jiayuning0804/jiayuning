# 体竞游IP合作推荐工具 — 后端代理服务

将 DeepSeek API Key 隐藏在服务端，前端通过 `/api/chat` 接口与 AI 交互，避免密钥泄露。

## 项目结构

```
proxy-server/
├── server.js          # Node.js 代理服务主文件
├── package.json       # 项目配置 & 依赖
├── .env.example       # 环境变量模板
├── .gitignore
├── README.md
└── public/            # 前端静态文件（放在这里自动托管）
    ├── index.html     # 主页面
    ├── admin.html     # 管理页面
    ├── app.js         # 主页面逻辑
    ├── admin.js       # 管理页面逻辑
    ├── data.js        # 数据配置（已移除 API Key）
    ├── common.js      # 公共函数（callLLM、showToast 等）
    └── styles.css     # 样式
```

## 快速开始

### 1. 安装依赖

```bash
cd proxy-server
npm install
```

### 2. 配置环境变量

```bash
# 复制模板
cp .env.example .env

# 编辑 .env，填入你的 DeepSeek API Key
# DEEPSEEK_API_KEY=sk-your-actual-key-here
```

### 3. 放置前端文件

将所有前端文件（`index.html`、`admin.html`、`app.js`、`admin.js`、`styles.css` 等）复制到 `public/` 目录。

> ⚠️ 注意：`public/data.js` 和 `public/common.js` 已经是修改后的版本，**不要**覆盖它们。
> 其他前端文件（`app.js`、`admin.js`）需要做少量改动：删除其中的 `callLLM` / `showToast` / `escHtml` 函数定义，改为引用 `common.js`。

### 4. 前端文件改动说明

在 `index.html` 和 `admin.html` 中，添加 `common.js` 的引用（在 `data.js` 之后、`app.js` / `admin.js` 之前）：

```html
<script src="data.js"></script>
<script src="common.js"></script>  <!-- 新增 -->
<script src="app.js"></script>
```

从 `app.js` 和 `admin.js` 中**删除**以下函数（已移到 `common.js`）：
- `callLLM()`
- `showToast()`
- `escHtml()`

### 5. 启动服务

```bash
# 生产模式
npm start

# 开发模式（文件修改后自动重启）
npm run dev
```

服务启动后访问 `http://localhost:3000` 即可使用。

## 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DEEPSEEK_API_KEY` | ✅ | — | DeepSeek API 密钥 |
| `PORT` | ❌ | `3000` | 服务监听端口 |

## 安全措施

- ✅ API Key 仅存在于服务端，前端无法获取
- ✅ 请求频率限制：每个 IP 每分钟最多 10 次
- ✅ 请求体大小限制：100KB
- ✅ 输入校验：messages 格式、长度等
- ✅ 错误信息脱敏：不向前端暴露原始 API 错误细节
- ✅ 请求超时：30 秒

## API 接口

### POST /api/chat

**请求体：**

```json
{
  "messages": [
    { "role": "system", "content": "你是一个助手" },
    { "role": "user", "content": "你好" }
  ],
  "model": "deepseek-chat",
  "temperature": 0.3,
  "max_tokens": 1000
}
```

**成功响应：**

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "你好！有什么可以帮你的？"
      }
    }
  ],
  "usage": { "prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18 }
}
```

**错误响应：**

```json
{
  "error": "错误描述（脱敏后）"
}
```
