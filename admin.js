/**
 * admin.js — 管理后台逻辑（IP管理 + AI配置）
 */

// ===== 页面导航 =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('page-' + page).classList.add('active');
    if (page === 'manage') renderIPTable();
    if (page === 'config') loadConfig();
  });
});

// ===== Toast提示 =====
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
  // P2-19: 动态时长
  const duration = Math.max(2800, msg.length * 80);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== 大模型 API 调用（P1-6: 含超时机制）=====
async function callLLM(messages, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const config = DB.getConfig();
    const resp = await fetch(BUILTIN_LLM.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + BUILTIN_LLM.apiKey
      },
      body: JSON.stringify({
        model: config.model || BUILTIN_LLM.model,
        messages,
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `API请求失败 (${resp.status})`);
    }
    const data = await resp.json();
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时（90秒），请稍后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ===== HTML转义 =====
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== 防抖工具（P2-11）=====
function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ===== IP管理页逻辑 =====
function renderIPTable(filter = '') {
  const list = DB.getIPs().filter(ip =>
    !filter || ip.name.toLowerCase().includes(filter.toLowerCase())
  );
  const tbody = document.getElementById('ip-table-body');
  const empty = document.getElementById('ip-empty');

  if (list.length === 0) {
    tbody.innerHTML = '';
    document.querySelector('.ip-table').style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  document.querySelector('.ip-table').style.display = 'table';
  empty.style.display = 'none';

  // P1-5: 使用 data 属性代替 onclick 内联拼接
  tbody.innerHTML = list.map(ip => `
    <tr>
      <td class="cell-name">${escHtml(ip.name)}</td>
      <td>${escHtml(ip.category || '-')}</td>
      <td>${escHtml(ip.target || '-')}</td>
      <td>${escHtml(ip.budget || '-')}</td>
      <td>${(ip.scene || '-').split('、').map(s => `<span class="cell-tag">${escHtml(s)}</span>`).join('')}</td>
      <td>${escHtml(ip.milestones || '-')}</td>
      <td>${escHtml(ip.tone || '-')}</td>
      <td>
        <button class="btn-edit" data-action="edit" data-id="${escHtml(ip.id)}">编辑</button>
        <button class="btn-delete" data-action="delete" data-id="${escHtml(ip.id)}" data-name="${escHtml(ip.name)}">删除</button>
      </td>
    </tr>
  `).join('');
}

// P1-5: 事件委托，统一处理表格按钮点击
document.getElementById('ip-table-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  if (btn.dataset.action === 'edit') openEditModal(id);
  if (btn.dataset.action === 'delete') deleteIP(id, name);
});

// P2-11: 搜索防抖
document.getElementById('ip-search').addEventListener('input', debounce((e) => {
  renderIPTable(e.target.value);
}, 200));

document.getElementById('add-ip-btn').addEventListener('click', () => openAddModal());

function openAddModal() {
  document.getElementById('modal-title').textContent = '新增IP';
  document.getElementById('ip-id').value = '';
  document.getElementById('ip-form').reset();
  document.getElementById('ip-modal').style.display = 'flex';
}

function openEditModal(id) {
  const ip = DB.getIPs().find(ip => ip.id === id);
  if (!ip) return;
  document.getElementById('modal-title').textContent = '编辑IP';
  document.getElementById('ip-id').value = ip.id;
  document.getElementById('ip-name').value = ip.name || '';
  document.getElementById('ip-category').value = ip.category || '';
  document.getElementById('ip-target').value = ip.target || '';
  document.getElementById('ip-budget').value = ip.budget || '';
  document.getElementById('ip-scene').value = ip.scene || '';
  document.getElementById('ip-tone').value = ip.tone || '';
  document.getElementById('ip-scale').value = ip.scale || '';
  document.getElementById('ip-desc').value = ip.desc || '';
  document.getElementById('ip-milestones').value = ip.milestones || '';
  document.getElementById('ip-cases').value = ip.cases || '';
  document.getElementById('ip-opinion').value = ip.opinion || '';
  document.getElementById('ip-modal').style.display = 'flex';
}

function deleteIP(id, name) {
  if (!confirm(`确定要删除「${name}」吗？删除后无法恢复。`)) return;
  DB.deleteIP(id);
  renderIPTable(document.getElementById('ip-search').value);
  showToast(`已删除「${name}」`, 'error');
}

function closeModal() {
  document.getElementById('ip-modal').style.display = 'none';
}

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
document.querySelector('.modal-overlay').addEventListener('click', closeModal);

// P2-13: ESC 关闭弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('ip-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('ip-id').value;
  const data = {
    name: document.getElementById('ip-name').value.trim(),
    category: document.getElementById('ip-category').value.trim(),
    target: document.getElementById('ip-target').value.trim(),
    budget: document.getElementById('ip-budget').value.trim(),
    scene: document.getElementById('ip-scene').value.trim(),
    tone: document.getElementById('ip-tone').value.trim(),
    scale: document.getElementById('ip-scale').value.trim(),
    desc: document.getElementById('ip-desc').value.trim(),
    milestones: document.getElementById('ip-milestones').value.trim(),
    cases: document.getElementById('ip-cases').value.trim(),
    opinion: document.getElementById('ip-opinion').value.trim(),
  };

  if (id) {
    DB.updateIP(id, data);
    showToast(`「${data.name}」已更新`, 'success');
  } else {
    DB.addIP(data);
    showToast(`「${data.name}」已添加`, 'success');
  }

  closeModal();
  renderIPTable(document.getElementById('ip-search').value);
});

// ===== IP库 导出 / 导入 =====
document.getElementById('export-ip-btn').addEventListener('click', () => {
  const list = DB.getIPs();
  if (!list.length) {
    showToast('IP库为空，无可导出内容', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `IP库_${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已导出 ${list.length} 个IP`, 'success');
});

document.getElementById('import-ip-btn').addEventListener('click', () => {
  document.getElementById('import-ip-file').click();
});

document.getElementById('import-ip-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  // P1-9: 导入文件大小和格式校验
  if (file.size > 5 * 1024 * 1024) {
    showToast('文件过大，请控制在 5MB 以内', 'error');
    e.target.value = '';
    return;
  }
  if (!file.name.endsWith('.json')) {
    showToast('仅支持 .json 格式文件', 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error('文件格式不正确，应为IP数组');
      const valid = parsed.filter(item => item && typeof item === 'object' && (item.name || '').trim());
      if (valid.length === 0) throw new Error('文件中没有有效的IP数据（缺少 name 字段）');

      const current = DB.getIPs();
      const choice = current.length > 0
        ? confirm(`检测到 ${valid.length} 个IP。\n\n点「确定」= 合并追加到现有 ${current.length} 个IP后面\n点「取消」= 用导入的数据【覆盖】现有IP库`)
        : true;

      // P2-23: 使用 crypto.randomUUID
      const normalize = (item) => ({
        id: item.id ? String(item.id) : crypto.randomUUID(),
        name: item.name || '',
        category: item.category || '',
        target: item.target || '',
        budget: item.budget || '',
        scene: item.scene || '',
        tone: item.tone || '',
        scale: item.scale || '',
        desc: item.desc || '',
        milestones: item.milestones || '',
        cases: item.cases || '',
        opinion: item.opinion || '',
        createdAt: item.createdAt || new Date().toISOString()
      });

      let finalList;
      if (choice) {
        const imported = valid.map(v => normalize({ ...v, id: '' }));
        finalList = current.concat(imported);
        showToast(`已合并导入 ${valid.length} 个IP`, 'success');
      } else {
        finalList = valid.map(normalize);
        showToast(`已覆盖导入 ${valid.length} 个IP`, 'success');
      }
      DB.saveIPs(finalList);
      renderIPTable(document.getElementById('ip-search').value);
    } catch (err) {
      showToast('导入失败：' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
});

// ===== AI配置页逻辑 =====
function loadConfig() {
  const config = DB.getConfig();
  document.getElementById('recommend-count').value = String(config.recommendCount || 5);
  document.getElementById('system-prompt').value = config.systemPrompt || DEFAULT_CONFIG.systemPrompt;
}

// 测试连接（P2-20: 改为检查 HTTP 状态码）
const testApiBtn = document.getElementById('test-api-btn');
if (testApiBtn) {
  testApiBtn.addEventListener('click', async () => {
    const result = document.getElementById('api-test-result');
    testApiBtn.disabled = true;
    testApiBtn.textContent = '测试中…';
    result.textContent = '';
    try {
      await callLLM([{ role: 'user', content: 'hi' }], 15000);
      result.textContent = '✅ 连接成功！';
      result.className = 'test-result success';
    } catch (err) {
      result.textContent = '❌ ' + err.message;
      result.className = 'test-result error';
    } finally {
      testApiBtn.disabled = false;
      testApiBtn.textContent = '🔍 测试连接';
    }
  });
}

function readConfigFromForm() {
  return {
    recommendCount: parseInt(document.getElementById('recommend-count').value),
    systemPrompt: document.getElementById('system-prompt').value
  };
}

document.getElementById('save-config-btn').addEventListener('click', () => {
  DB.saveConfig(readConfigFromForm());
  showToast('配置已保存', 'success');
});

document.getElementById('reset-prompt-btn').addEventListener('click', () => {
  if (!confirm('确定要恢复默认提示词吗？当前修改将丢失。')) return;
  document.getElementById('system-prompt').value = DEFAULT_CONFIG.systemPrompt;
  showToast('已恢复默认提示词');
});

document.getElementById('test-prompt-btn').addEventListener('click', async () => {
  const btn = document.getElementById('test-prompt-btn');
  const area = document.getElementById('test-result-area');

  const config = readConfigFromForm();
  DB.saveConfig(config);

  btn.disabled = true;
  btn.textContent = '⏳ 测试中…';
  area.style.display = 'block';
  area.textContent = 'AI分析中，请稍候…';

  const ipList = DB.getIPs();
  const ipListText = ipList.map((ip, i) => `
【IP ${i + 1}】${ip.name}
- 游戏品类：${ip.category || '未填写'}
- 目标用户：${ip.target || '未填写'}
- 预算区间：${ip.budget || '未填写'}
- 适合场景：${ip.scene || '未填写'}
- IP调性：${ip.tone || '未填写'}
- 合作节点：${ip.milestones || '未填写'}
- IP简介：${ip.desc || '未填写'}
`).join('\n');

  const testMessage = `
【合作需求（示例）】
预算范围：50-100万
目标用户：Z世代(18-25岁)、女性用户为主
游戏品类偏好：二次元游戏、手游
合作场景：联名产品/周边、线上推广/社媒传播
补充说明：希望IP有较强的女性用户基础，品牌调性偏精致唯美

【可选IP资源库（共${ipList.length}个IP）】
${ipListText}

请从以上IP资源库中，推荐最多${config.recommendCount}个最适合该需求的IP。`;

  try {
    const content = await callLLM([
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: testMessage }
    ]);
    area.textContent = content;
  } catch (err) {
    area.textContent = '❌ 错误：' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ 用示例需求测试';
  }
});

// ===== 侧边栏拖拽调节 =====
(function initSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  if (!resizer) return;

  const sidebar = document.querySelector('.sidebar');
  const MIN_WIDTH = 140;
  const MAX_WIDTH = 360;
  const STORAGE_KEY = 'admin_sidebar_width';

  // 恢复上次保存的宽度
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved);
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
      sidebar.style.width = w + 'px';
      sidebar.style.minWidth = w + 'px';
      sidebar.style.maxWidth = w + 'px';
    }
  }

  let startX = 0;
  let startWidth = 0;

  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    let newWidth = Math.round(startWidth + dx);
    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
    sidebar.style.width = newWidth + 'px';
    sidebar.style.minWidth = newWidth + 'px';
    sidebar.style.maxWidth = newWidth + 'px';
  }

  function onMouseUp() {
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    const finalWidth = sidebar.getBoundingClientRect().width;
    localStorage.setItem(STORAGE_KEY, Math.round(finalWidth));
  }

  resizer.addEventListener('mousedown', onMouseDown);
})();

// ===== 初始化 =====
(function init() {
  DB.getIPs();
  renderIPTable();
  loadConfig();
})();
