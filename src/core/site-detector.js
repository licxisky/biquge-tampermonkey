// 站点检测模块
// 功能：检测当前站点并匹配选择器策略

import { SITE_SELECTORS } from '../data/site-selectors.js';
import { SiteRuleManager } from '../rules/site-rule-manager.js';

// Toast 辅助函数
function showToast(msg, type = 'success', duration = 2500) {
  // 简单实现，后续会被 ToastManager 替代
  console.log(`[${type}] ${msg}`);
}

export function detectSiteStructure() {
  const currentHostname = window.location.hostname;

  // 辅助函数：提取主域名（去掉 www. 前缀）
  const getMainDomain = (hostname) => hostname.replace(/^www\./, '');

  // 1. 优先检查自定义规则中是否有 hostname 匹配
  const customRules = SiteRuleManager.getCustomRules();
  const hostnameMatchedRule = customRules.find(rule => {
    if (!rule.hostname) return false;
    return rule.hostname === currentHostname ||
           getMainDomain(rule.hostname) === getMainDomain(currentHostname);
  });

  if (hostnameMatchedRule) {
    console.log(`[站点检测] 使用自定义规则（hostname匹配）: ${hostnameMatchedRule.name}`);
    return hostnameMatchedRule;
  }

  // 2. 遍历内置规则（包括自定义规则中无 hostname 的）
  const allRules = SiteRuleManager.getAllRules();
  for (const selector of allRules) {
    const tocElement = document.querySelector(selector.toc);
    if (!tocElement) continue;

    // hostname 匹配
    if (selector.hostname) {
      const hostnameMatch = selector.hostname === currentHostname ||
                             getMainDomain(selector.hostname) === getMainDomain(currentHostname);
      if (!hostnameMatch) continue;
    }

    // tocPattern 匹配
    if (selector.tocPattern) {
      let patternMatched = false;

      if (tocElement.textContent.includes(selector.tocPattern)) {
        patternMatched = true;
      } else {
        let prevSibling = tocElement.previousElementSibling;
        let checkedCount = 0;
        while (prevSibling && checkedCount < 3) {
          if (prevSibling.textContent.includes(selector.tocPattern)) {
            patternMatched = true;
            break;
          }
          prevSibling = prevSibling.previousElementSibling;
          checkedCount++;
        }
      }

      if (!patternMatched) continue;
    }

    const ruleType = selector.custom ? '自定义规则' : '内置规则';
    console.log(`[站点检测] 使用 ${ruleType} - ${selector.name} 选择器策略`);
    return selector;
  }

  console.warn('[站点检测] 未匹配到已知站点，使用默认策略');
  showToast('⚠️ 未能识别当前站点，建议使用「🎯 手动标记」功能设置规则', 'warn', 4500);
  return SITE_SELECTORS[0];
}
