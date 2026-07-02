/**
 * app.js — 用户端逻辑（仅智能匹配）
 * 公共函数 callLLM / showToast / escHtml / debounce 已移至 common.js
 */

// ===== 下拉多选组件 =====
function updateMultiselectLabel(ms) {
  const labelEl = ms.querySelector('.ms-label');
  const placeholder = ms.dataset.placeholder || '请选择';
  const isSingle = ms.dataset.single === 'true';
  const inputType = isSingle ? 'radio' : 'checkbox';
  const checked = [...ms.querySelectorAll(`input[type="${inputType}"]:checked`)];
  if (checked.length === 0) {
    labelEl.textContent = placeholder;
    labelEl.classList.add('placeholder');
  } else if (!isSingle && checked.length > 2) {
    // P2-14: 多选超过2项时显示"已选N项"
    labelEl.textContent = `已选${checked.length}项`;
    labelEl.classList.remove('placeholder');
  } else {
    labelEl.textContent = checked.map(c => c.value).join('、');
    labelEl.classList.remove('placeholder');
  }
}

function initMultiselects() {
  document.querySelectorAll('.multiselect').forEach(ms => {
    const trigger = ms.querySelector('.ms-trigger');
    const isSingle = ms.dataset.single === 'true';
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = ms.classList.contains('open');
      document.querySelectorAll('.multiselect.open').forEach(o => o.classList.remove('open'));
      if (!isOpen) ms.classList.add('open');
    });
    if (isSingle) {
      ms.querySelectorAll('input[type="radio"]').forEach(rb => {
        rb.addEventListener('change', () => {
          updateMultiselectLabel(ms);
          setTimeout(() => ms.classList.remove('open'), 150);
        });
      });
    } else {
      ms.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => updateMultiselectLabel(ms));
      });
    }
    ms.querySelector('.ms-panel').addEventListener('click', (e) => e.stopPropagation());
    updateMultiselectLabel(ms);
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.multiselect.open').forEach(o => o.classList.remove('open'));
  });
}

// ===== 两步视图切换 =====
function showStep(step) {
  const formPanel = document.getElementById('step-form');
  const resultPanel = document.getElementById('step-result');
  if (step === 'form') {
    formPanel.style.display = 'block';
    resultPanel.classList.remove('active');
  } else {
    formPanel.style.display = 'none';
    resultPanel.classList.add('active');
  }
}

document.getElementById('back-to-form-btn').addEventListener('click', () => showStep('form'));

// ===== 保存最后提交的表单数据以便重试（P2-16）=====
let lastFormData = null;

// ===== 推荐表单提交 =====
document.getElementById('recommend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await doRecommend();
});

async function doRecommend() {
  const btn = document.getElementById('submit-btn');
  const resultArea = document.getElementById('result-area');

  const budgetRadio = document.querySelector('input[name="budget"]:checked');
  const budget = budgetRadio ? budgetRadio.value : '';
  const targets = [...document.querySelectorAll('input[name="target"]:checked')].map(el => el.value);
  const categories = [...document.querySelectorAll('input[name="category"]:checked')].map(el => el.value);
  const scenes = [...document.querySelectorAll('input[name="scene"]:checked')].map(el => el.value);
  const extra = document.getElementById('extra').value.trim();

  if (!budget && targets.length === 0 && categories.length === 0 && scenes.length === 0) {
    showToast('请至少填写一项需求条件', 'error');
    return;
  }

  lastFormData = { budget, targets, categories, scenes, extra };
  showStep('result');

  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = '⏳ AI分析中…';
  resultArea.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>AI正在分析需求，匹配最合适的IP…</p>
    </div>`;

  try {
    const ipList = DB.getIPs();
    const config = DB.getConfig();
    const count = config.recommendCount || 5;

    const requirementParts = [];
    if (budget) requirementParts.push(`预算范围：${budget}`);
    if (targets.length) requirementParts.push(`目标用户：${targets.join('、')}`);
    if (categories.length) requirementParts.push(`游戏品类偏好：${categories.join('、')}`);
    if (scenes.length) requirementParts.push(`合作场景：${scenes.join('、')}`);
    if (extra) requirementParts.push(`补充说明：${extra}`);

    const requirementText = requirementParts.join('\n');

    const ipListText = ipList.map((ip, i) => `
【IP ${i + 1}】${ip.name}
- 游戏品类：${ip.category || '未填写'}
- 目标用户：${ip.target || '未填写'}
- 预算区间：${ip.budget || '未填写'}
- 适合场景：${ip.scene || '未填写'}
- IP调性：${ip.tone || '未填写'}
- 用户规模：${ip.scale || '未填写'}
- IP简介：${ip.desc || '未填写'}
- 合作节点：${ip.milestones || '未填写'}
- 合作案例：${ip.cases || '无'}
`).join('\n');

    const userMessage = `
【合作需求】
${requirementText}

【可选IP资源库（共${ipList.length}个IP）】
${ipListText}

请从以上IP资源库中，推荐最多${count}个最适合该需求的IP，按匹配度从高到低排列。`;

    const content = await callLLM([
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: userMessage }
    ]);

    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      resultArea.innerHTML = `<div class="ip-card"><div class="ip-card-reason">${content.replace(/\n/g, '<br>')}</div></div>`;
      return;
    }

    // P2-22: 模糊匹配
    if (result.recommendations) {
      const ipList2 = DB.getIPs();
      result.recommendations.forEach(rec => {
        if (!rec.name) return;
        const exactMatch = ipList2.find(ip => ip.name && ip.name.trim() === rec.name.trim());
        if (!exactMatch) {
          const fuzzy = ipList2.find(ip =>
            ip.name && (
              ip.name.includes(rec.name.trim()) ||
              rec.name.trim().includes(ip.name.trim())
            )
          );
          if (fuzzy) rec.name = fuzzy.name;
        }
      });
    }

    renderRecommendResult(result);

  } catch (err) {
    const raw = err.message || '未知错误';
    let friendly = raw;
    let tip = '请稍后重试，或检查网络连接';
    if (/Insufficient Balance|balance/i.test(raw)) {
      friendly = 'AI 服务额度不足';
      tip = '当前账号余额已用尽，请联系管理员充值后再试';
    } else if (/401|403|Authentication|api key|invalid/i.test(raw)) {
      friendly = 'AI 服务鉴权失败';
      tip = '内置密钥可能已失效，请联系管理员更新';
    } else if (/429|rate limit/i.test(raw)) {
      friendly = '请求过于频繁';
      tip = '稍等片刻再重试即可';
    } else if (/Failed to fetch|NetworkError|network/i.test(raw)) {
      friendly = '网络连接失败';
      tip = '请检查网络后重试';
    } else if (/超时/.test(raw)) {
      friendly = '请求超时';
      tip = 'AI 响应时间过长，请稍后重试';
    }
    resultArea.innerHTML = `
      <div class="result-placeholder">
        <div class="placeholder-icon">⚠️</div>
        <p style="color:#ef4444;">${escHtml(friendly)}</p>
        <p style="margin-top:8px;font-size:12px;color:#9ca3af;">${escHtml(tip)}</p>
        <button type="button" class="retry-btn" id="retry-btn">🔄 重新尝试</button>
      </div>`;
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => doRecommend());
    }
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '✨ 开始推荐';
  }
}

// ===== 推荐结果渲染 =====
let lastRecommendResult = null;

function recommendResultToText(result) {
  const recs = result.recommendations || [];
  const ipList = DB.getIPs();
  const lines = [];
  if (result.summary) lines.push(`【推荐思路】${result.summary}`, '');
  recs.forEach((rec, i) => {
    lines.push(`${i + 1}. ${rec.name || ''}${rec.matchScore ? `（匹配度 ${rec.matchScore}%）` : ''}`);
    if (rec.category) lines.push(`   品类：${rec.category}`);
    if (rec.tags && rec.tags.length) lines.push(`   标签：${rec.tags.join('、')}`);
    if (rec.reason) lines.push(`   理由：${rec.reason}`);
    const matched = ipList.find(ip => ip.name && rec.name && ip.name.trim() === rec.name.trim());
    if (matched && matched.opinion) lines.push(`   💬 个人意见：${matched.opinion}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

async function copyRecommendResult() {
  if (!lastRecommendResult) return;
  const text = recommendResultToText(lastRecommendResult);
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制推荐结果', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('已复制推荐结果', 'success'); }
    catch { showToast('复制失败，请手动选择文本复制', 'error'); }
    document.body.removeChild(ta);
  }
}

function renderRecommendResult(result) {
  const resultArea = document.getElementById('result-area');
  const recs = result.recommendations || [];

  if (recs.length === 0) {
    resultArea.innerHTML = `<div class="result-placeholder"><div class="placeholder-icon">🤔</div><p>暂无匹配的IP，请尝试调整需求条件</p></div>`;
    return;
  }

  lastRecommendResult = result;
  const ipList = DB.getIPs();

  let html = '<div class="result-toolbar"><button type="button" class="btn-copy" id="copy-result-btn">📋 复制结果</button></div>';
  if (result.summary) {
    html += `<div style="background:var(--primary-light);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--text-sub);line-height:1.6;">
      <strong style="color:var(--text-main);">💡 推荐思路：</strong>${result.summary}
    </div>`;
  }

  recs.forEach((rec, i) => {
    const tags = (rec.tags || []).map(t => `<span class="ip-tag">${escHtml(t)}</span>`).join('');
    const score = rec.matchScore ? `<span style="font-size:12px;color:var(--text-sub);margin-left:8px;">匹配度 ${escHtml(rec.matchScore)}%</span>` : '';
    const matched = ipList.find(ip => ip.name && rec.name && ip.name.trim() === rec.name.trim());
    const opinionHtml = (matched && matched.opinion)
      ? `<div class="ip-card-opinion"><span class="opinion-label">💬 个人意见</span><span class="opinion-text">${escHtml(matched.opinion)}</span></div>`
      : '';

    // 合作参考案例渲染
    let casesHtml = '';
    if (rec.cases && rec.cases.length > 0) {
      const casesItems = rec.cases.map(c => {
        const linkHtml = c.url
          ? `<a href="${escHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="case-link">查看详情 ↗</a>`
          : '';
        return `
          <div class="case-item">
            <div class="case-title">${escHtml(c.title || '')}</div>
            <div class="case-detail"><span class="case-label">合作形式：</span>${escHtml(c.form || '')}</div>
            <div class="case-detail"><span class="case-label">合作效果：</span>${escHtml(c.effect || '')}</div>
            ${linkHtml}
          </div>`;
      }).join('');
      casesHtml = `
        <div class="ip-card-cases">
          <div class="cases-header">📋 合作参考案例</div>
          ${casesItems}
        </div>`;
    }

    html += `
      <div class="ip-card">
        <div class="ip-card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="ip-card-rank">推荐 ${i + 1}</span>
            <span class="ip-card-name">${escHtml(rec.name)}</span>
            ${score}
          </div>
          <span style="font-size:12px;color:var(--text-sub);">${escHtml(rec.category || '')}</span>
        </div>
        ${tags ? `<div class="ip-card-tags">${tags}</div>` : ''}
        <div class="ip-card-reason">${escHtml(rec.reason || '')}</div>
        ${casesHtml}
        ${opinionHtml}
      </div>`;
  });

  resultArea.innerHTML = html;

  const copyBtn = document.getElementById('copy-result-btn');
  if (copyBtn) copyBtn.addEventListener('click', copyRecommendResult);
}

// ===== 初始化 =====
(function init() {
  DB.getIPs();
  initMultiselects();
})();
