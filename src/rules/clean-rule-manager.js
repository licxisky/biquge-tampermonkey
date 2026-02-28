// 清洗规则管理模块
// 功能：管理内容清洗正则规则

export const CleanRuleManager = {
  // 获取默认清洗规则
  getDefaultRules() {
    const TLDS = 'com|net|org|cn|cc|io|la|xyz|tv|me|info|biz|top|vip|pro|tw|hk|uk|us|jp|co';
    return [
      { id: 1, name: '站点推广文案', pattern: '(本站推荐|笔趣阁.*?最快更新|请记住本站域名|一秒记住.*?为您提供|最新网址).*?[。！]', flags: 'g', enabled: true, builtin: true },
      { id: 2, name: '特殊标记和括号', pattern: '(【.*?提供.*?】|\\(.*?请搜索.*?\\))', flags: 'g', enabled: true, builtin: true },
      { id: 3, name: '域名和网址', pattern: `(https?:\\/\\/[^\\s]+|www\\.[^\\s]+\\.\\w{2,4}|[a-z0-9]{2,}[^a-z\\u4e00-\\u9fa5\\r\\n]+(?:${TLDS})\\b)\\s?`, flags: 'gi', enabled: true, builtin: true },
      { id: 4, name: '分割线', pattern: '([-═]{3,}.*?[-═]{3,}|[-═]{3,})', flags: 'g', enabled: true, builtin: true },
      { id: 8, name: '导航栏元素', pattern: '(上一章|下一章|下一页|目录|书签)(?=\\s|\\n|$)', flags: 'gim', enabled: true, builtin: true },
      { id: 6, name: '重复英文短字符串', pattern: '\\b([a-z]{3,10})\\s+\\1\\s+\\1\\b', flags: 'gi', enabled: true, builtin: true },
      { id: 7, name: '重复中文短语', pattern: '([\\u4e00-\\u9fa5]{2,4})\\s*\\1\\s*\\1', flags: 'g', enabled: true, builtin: true }
    ];
  },

  getCustomRules() {
    const rules = localStorage.getItem('bqg_clean_rules');
    return rules ? JSON.parse(rules) : [];
  },

  saveCustomRules(rules) {
    localStorage.setItem('bqg_clean_rules', JSON.stringify(rules));
  },

  getAllRules() {
    return [...this.getDefaultRules(), ...this.getCustomRules()];
  },

  getEnabledPatterns() {
    return this.getAllRules()
      .filter(rule => rule.enabled)
      .map(rule => {
        try {
          return new RegExp(rule.pattern, rule.flags);
        } catch (e) {
          console.error(`清洗规则"${rule.name}"格式错误:`, e);
          return null;
        }
      })
      .filter(r => r !== null);
  },

  addRule(rule) {
    const rules = this.getCustomRules();
    rules.push({ ...rule, id: Date.now(), enabled: true, builtin: false });
    this.saveCustomRules(rules);
    return true;
  },

  updateRule(id, updates) {
    const numId = Number(id);
    const rules = this.getCustomRules();
    const index = rules.findIndex(r => Number(r.id) === numId);
    if (index !== -1) {
      rules[index] = { ...rules[index], ...updates };
      this.saveCustomRules(rules);
      return true;
    }
    return false;
  },

  deleteRule(id) {
    const numId = Number(id);
    const before = this.getCustomRules();
    const after = before.filter(r => Number(r.id) !== numId);
    if (after.length === before.length) return false;
    this.saveCustomRules(after);
    return true;
  },

  toggleRule(id, enabled) {
    const numId = Number(id);
    const customRules = this.getCustomRules();
    const customIndex = customRules.findIndex(r => Number(r.id) === numId);

    if (customIndex !== -1) {
      customRules[customIndex].enabled = enabled;
      this.saveCustomRules(customRules);
    } else {
      const disabledBuiltins = JSON.parse(localStorage.getItem('bqg_disabled_builtin_rules') || '[]').map(Number);
      if (enabled) {
        const newDisabled = disabledBuiltins.filter(ruleId => ruleId !== numId);
        localStorage.setItem('bqg_disabled_builtin_rules', JSON.stringify(newDisabled));
      } else {
        if (!disabledBuiltins.includes(numId)) {
          disabledBuiltins.push(numId);
          localStorage.setItem('bqg_disabled_builtin_rules', JSON.stringify(disabledBuiltins));
        }
      }
    }
  },

  isBuiltinRuleDisabled(id) {
    const disabledBuiltins = JSON.parse(localStorage.getItem('bqg_disabled_builtin_rules') || '[]').map(Number);
    return disabledBuiltins.includes(Number(id));
  },

  getAllRulesWithStatus() {
    const defaultRules = this.getDefaultRules().map(rule => ({
      ...rule,
      enabled: !this.isBuiltinRuleDisabled(rule.id)
    }));
    const customRules = this.getCustomRules();
    return [...defaultRules, ...customRules];
  },

  exportRules() {
    const rules = this.getCustomRules();
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bqg_clean_rules_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importRules(jsonStr) {
    try {
      const rules = JSON.parse(jsonStr);
      if (!Array.isArray(rules)) throw new Error('规则格式错误');

      for (const rule of rules) {
        if (!rule.name || !rule.pattern || !rule.flags) {
          throw new Error('规则缺少必需字段（name, pattern, flags）');
        }
        new RegExp(rule.pattern, rule.flags);
      }

      const existingRules = this.getCustomRules();
      const mergedRules = [...existingRules, ...rules.map(r => ({
        ...r,
        id: Date.now() + Math.random(),
        enabled: r.enabled !== false,
        builtin: false
      }))];

      this.saveCustomRules(mergedRules);
      return true;
    } catch (e) {
      console.error('导入失败:', e);
      return false;
    }
  },

  resetToDefault() {
    localStorage.removeItem('bqg_clean_rules');
    localStorage.removeItem('bqg_disabled_builtin_rules');
  }
};
