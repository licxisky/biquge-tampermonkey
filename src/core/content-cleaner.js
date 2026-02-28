// 内容清洗模块
// 功能：应用清洗规则移除垃圾内容

import { CleanRuleManager } from '../rules/clean-rule-manager.js';

// 获取启用的清洗规则
let CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();

export function cleanContent(text) {
  let cleaned = text;

  // 应用所有正则清洗规则
  for (const pattern of CONTENT_CLEAN_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 清理只包含空白字符的行
  cleaned = cleaned.replace(/[ \t\r]+\n/g, '\n');

  // 清理大量连续空行
  cleaned = cleaned.replace(/\n{2,}/g, '\n\n');

  // 清理首尾空白
  cleaned = cleaned.trim();

  return cleaned;
}

// 重新加载清洗规则（供外部调用）
export function reloadCleanPatterns() {
  CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
}
