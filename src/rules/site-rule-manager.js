// 站点规则管理模块
// 功能：管理站点选择器规则

import { SITE_SELECTORS } from '../data/site-selectors.js';

export const SiteRuleManager = {
  getCustomRules() {
    const rules = localStorage.getItem('bqg_custom_rules');
    return rules ? JSON.parse(rules) : [];
  },

  saveCustomRules(rules) {
    localStorage.setItem('bqg_custom_rules', JSON.stringify(rules));
  },

  getAllRules() {
    return [...SITE_SELECTORS, ...this.getCustomRules()];
  },

  addRule(rule) {
    try {
      const rules = this.getCustomRules();
      rules.push({ ...rule, id: Date.now(), custom: true });
      this.saveCustomRules(rules);
      return true;
    } catch (e) {
      console.error('添加规则失败:', e);
      return false;
    }
  },

  deleteRule(id) {
    const numId = Number(id);
    const before = this.getCustomRules();
    const after = before.filter(r => Number(r.id) !== numId);
    if (after.length === before.length) return false;
    this.saveCustomRules(after);
    return true;
  },

  exportRules() {
    const rules = this.getCustomRules();
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bqg_rules_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importRules(jsonStr) {
    try {
      const rules = JSON.parse(jsonStr);
      if (!Array.isArray(rules)) throw new Error('规则格式错误');
      this.saveCustomRules(rules);
      return true;
    } catch (e) {
      console.error('导入失败:', e);
      return false;
    }
  }
};
