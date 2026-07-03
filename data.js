/**
 * data.js — 本地数据持久化层
 * 所有数据存储在 localStorage，刷新不丢失
 */

// ===================================================================
//  内置大模型凭证（同事零配置，直接使用，消耗本 Key 对应账户额度）
// -------------------------------------------------------------------
//  ⚠️ 安全提醒：
//  1. 此 Key 会随网页发布给所有使用者，等同公开。请仅在公司内部环境使用。
//  2. 请勿将本文件上传到任何「公开」代码仓库（如公开 GitHub），否则 Key 必被扒走盗刷。
//  3. 建议在 DeepSeek 后台为该 Key 设置「消费上限」，把万一被盗刷的损失封死。
//  4. 更换 Key 时，只需修改下面这一处 apiKey 即可。
// ===================================================================
const BUILTIN_LLM = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-caaa748663fc4e8f8bad2fc6c1080566',
  model: 'deepseek-chat'
};

const DB = {
  // ===== IP数据 =====
  getIPs() {
    // P2-24: 区分首次使用和用户主动清空
    if (localStorage.getItem('ip_initialized')) {
      const raw = localStorage.getItem('ip_list');
      if (!raw) return [];
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error('IP数据解析失败，已重置', e);
        localStorage.removeItem('ip_list');
        return [];
      }
    }
    // 首次使用，写入示例数据
    localStorage.setItem('ip_initialized', '1');
    this.saveIPs(SAMPLE_IPS);
    return SAMPLE_IPS;
  },

  saveIPs(list) {
    // P1-8: localStorage 容量保护
    const json = JSON.stringify(list);
    const sizeKB = new Blob([json]).size / 1024;
    if (sizeKB > 4096) {
      console.warn(`IP 数据已达 ${sizeKB.toFixed(0)}KB，接近浏览器限制`);
      if (typeof showToast === 'function') {
        showToast('数据量较大，建议导出备份后清理旧数据', 'warning');
      }
    }
    try {
      localStorage.setItem('ip_list', json);
    } catch (e) {
      console.error('localStorage 写入失败', e);
      if (typeof showToast === 'function') {
        showToast('存储空间不足，保存失败', 'error');
      }
    }
  },

  addIP(ip) {
    const list = this.getIPs();
    // P2-23: 使用 crypto.randomUUID 生成更健壮的 ID
    ip.id = crypto.randomUUID();
    ip.createdAt = new Date().toISOString();
    list.push(ip);
    this.saveIPs(list);
    return ip;
  },

  updateIP(id, data) {
    const list = this.getIPs();
    const idx = list.findIndex(ip => ip.id === id);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], ...data, id };
    this.saveIPs(list);
    return true;
  },

  deleteIP(id) {
    const list = this.getIPs().filter(ip => ip.id !== id);
    this.saveIPs(list);
  },

  // ===== AI配置 =====
  getConfig() {
    try {
      const raw = localStorage.getItem('ai_config');
      if (raw) {
        const saved = JSON.parse(raw);
        return {
          ...DEFAULT_CONFIG,
          ...saved,
          // 凭证类字段强制使用内置值
          provider: BUILTIN_LLM.provider,
          apiKey: BUILTIN_LLM.apiKey,
          model: BUILTIN_LLM.model
        };
      }
    } catch (e) {
      console.error('配置数据解析失败，已重置', e);
      localStorage.removeItem('ai_config');
    }
    return { ...DEFAULT_CONFIG, provider: BUILTIN_LLM.provider, apiKey: BUILTIN_LLM.apiKey, model: BUILTIN_LLM.model };
  },

  saveConfig(config) {
    try {
      localStorage.setItem('ai_config', JSON.stringify(config));
    } catch (e) {
      console.error('配置保存失败', e);
      if (typeof showToast === 'function') {
        showToast('配置保存失败，存储空间可能不足', 'error');
      }
    }
  }
};

// ===== 默认AI配置 =====
// P2-26: 移除冗余的 apiKey/provider/model，仅保留用户可配置字段
const DEFAULT_CONFIG = {
  recommendCount: 5,
  systemPrompt: `你是一位专业的游戏电竞IP联合营销顾问，服务于美团团购的市场营销团队。

你的任务是：根据用户提供的合作需求，从IP资源库中筛选并推荐最合适的游戏电竞IP，给出专业的推荐理由，并为每个推荐IP提供真实的合作参考案例。

【推荐原则】
1. 严格基于IP资源库中的真实数据进行推荐，不要编造不存在的IP
2. 综合考虑预算匹配度、目标用户重合度、合作场景适配性、IP调性契合度
3. 推荐数量按要求输出，优先推荐匹配度最高的
4. 每个推荐都要给出具体、有说服力的理由，结合需求方的实际诉求
5. 为每个推荐IP提供1-2个真实的行业合作参考案例，帮助需求方快速理解该IP的合作模式和效果

【合作参考案例要求】
- 优先引用该游戏IP与本地生活/餐饮/零售品牌的合作案例
- 如无本地生活案例，可引用该IP与其他品牌的经典联名合作
- 每个案例需包含：案例标题、合作形式简述、合作效果简述、参考链接（如有公开报道）
- 案例必须是真实发生过的，不要编造虚假案例
- 如果确实找不到公开案例，可基于IP资源库中的"合作案例"字段信息进行描述，链接字段留空

【字数限制】
每个 IP 的 reason 字段限 50 字以内，summary 字段限 100 字以内。案例描述每条限 80 字以内。语言精炼，直击要点。

【输出格式】
请严格按照以下JSON格式输出，不要有任何额外文字：
{
  "recommendations": [
    {
      "name": "IP名称",
      "category": "游戏品类",
      "tone": "IP调性",
      "matchScore": 95,
      "tags": ["标签1", "标签2", "标签3"],
      "reason": "推荐理由，1-2句话，简明扼要说明为什么适合，突出核心匹配点",
      "cases": [
        {
          "title": "案例标题，如：肯德基×原神联动套餐",
          "form": "合作形式，如：联名套餐+限定周边+门店主题装饰",
          "effect": "合作效果，如：活动期间门店销售额提升40%，社媒曝光超5亿",
          "url": "参考链接，如有公开报道填写URL，无则留空字符串"
        }
      ]
    }
  ],
  "summary": "整体推荐思路的一句话总结"
}`
};

// ===== 示例IP数据（根据你的实际业务预置）=====
const SAMPLE_IPS = [
  {
    id: '1',
    name: '王者荣耀KPL',
    category: 'MOBA/电竞赛事',
    target: 'Z世代、年轻白领、男女均衡',
    budget: '50-500万',
    scene: '赛事冠名、线下活动/快闪、KA商户联动、TVC/内容共创、买赠/权益合作',
    tone: '竞技热血、国民级、年轻潮流',
    scale: '月活1.5亿+',
    desc: '王者荣耀是腾讯旗下国民级MOBA手游，KPL为其职业联赛。用户基数庞大，男女比例均衡，覆盖全年龄段。赛事影响力强，具备强大的线上线下联动能力，是美团团购长期合作的核心IP。',
    milestones: '立项确认→方案策划→合同签署→赛事档期素材对接→线上线下活动执行→效果复盘',
    cases: '已与美团团购深度合作多年，包括赛事冠名、快闪活动、KA商户联动等多种形式，合作效果显著。',
    createdAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: '2',
    name: '无畏契约',
    category: 'FPS/端游',
    target: 'Z世代、男性用户为主、网吧用户',
    budget: '10-100万',
    scene: '线下活动/快闪、联名产品/周边、买赠/权益合作、线上推广/社媒传播',
    tone: '硬核竞技、潮流街头、国际化',
    scale: '国服月活3000万+',
    desc: 'Riot Games旗下战术射击游戏，在Z世代和硬核玩家中影响力极强。与网吧场景天然契合，已有美团团购x无畏契约x网吧联合营销的成功案例，买赠权益合作效果突出。',
    milestones: '需求对齐→合同审批→权益道具开发→网吧物料制作→活动上线→数据复盘',
    cases: '美团团购x无畏契约x网吧联合营销，线下物料覆盖全国网吧，买赠道具权益深受玩家喜爱。',
    createdAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: '3',
    name: '原神',
    category: '二次元/开放世界/手游',
    target: 'Z世代、女性用户较多、二次元爱好者',
    budget: '100-500万',
    scene: '联名产品/周边、线下活动/快闪、线上推广/社媒传播、TVC/内容共创',
    tone: '二次元、精致唯美、高品质、国际化',
    scale: '全球月活5000万+',
    desc: '米哈游旗下现象级开放世界游戏，全球影响力极强，用户付费意愿高，女性用户占比高于行业均值。IP联名溢价能力强，周边产品极受欢迎，适合高品质联名合作。',
    milestones: 'IP授权申请→创意方案确认→素材审核→周边生产→上线推广→效果追踪',
    cases: '美团团购x原神联动创意方案已落地，联名周边、线下活动等形式均有成功实践。',
    createdAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: '4',
    name: '金铲铲之战',
    category: 'TFT/自走棋/手游',
    target: 'Z世代、年轻白领、男女均衡',
    budget: '10-100万',
    scene: '买赠/权益合作、线上推广/社媒传播、KA商户联动',
    tone: '轻松休闲、萌系、年轻潮流',
    scale: '月活2000万+',
    desc: '腾讯旗下TFT手游，用户画像年轻，男女比例均衡，游戏节奏轻松，适合碎片化时间。IP形象萌系可爱，联名周边受欢迎，适合轻量级合作和买赠权益。',
    milestones: '需求确认→权益方案设计→技术对接→活动上线→数据回收',
    cases: '美团团购x金铲铲联动营销方案已落地，KA招商效果良好。',
    createdAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: '5',
    name: 'iG电竞俱乐部',
    category: '电竞俱乐部/英雄联盟',
    target: 'Z世代、男性用户为主、电竞核心用户',
    budget: '100-500万',
    scene: '赛事冠名/赞助、线下活动/快闪、TVC/内容共创、线上推广/社媒传播',
    tone: '竞技热血、专业电竞、粉丝经济',
    scale: '微博粉丝500万+',
    desc: '国内顶级英雄联盟电竞俱乐部，拥有大量忠实粉丝，选手个人IP影响力强。适合品牌冠名、选手联合营销等形式，粉丝转化率高。',
    milestones: '合作意向碰头→赞助方案确认→合同签署→选手/赛事档期匹配→内容制作发布→效果复盘',
    cases: '美团团购x iG电竞联合营销介绍材料已完成，冠名合作资源包丰富。',
    createdAt: '2026-06-01T00:00:00.000Z'
  }
];
