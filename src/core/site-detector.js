// 站点检测模块
// 功能：检测当前站点并匹配选择器策略

import { SITE_SELECTORS } from '../data/site-selectors.js';
import { SiteRuleManager } from '../rules/site-rule-manager.js';

// Toast 辅助函数
function showToast(msg, type = 'success', duration = 2500) {
  // 简单实现，后续会被 ToastManager 替代
  console.log(`[${type}] ${msg}`);
}

// 最小匹配章节数（用于回退规则验证）
const MIN_MATCH_CHAPTERS = 3;

/**
 * 尝试使用指定规则提取章节
 * @param {Object} rule - 规则对象
 * @returns {number} 成功提取的章节数量，-1 表示规则不适用
 */
function tryExtractChapters(rule) {
  try {
    const tocElement = document.querySelector(rule.toc);
    if (!tocElement) return -1;

    // 获取目录容器内的所有链接
    let chapterLinks = [];
    if (rule.titleSelector && rule.linkSelector) {
      // 使用 titleSelector 和 linkSelector 模式
      const items = tocElement.querySelectorAll(rule.titleSelector);
      items.forEach(item => {
        const titleEl = item.matches(rule.titleSelector) ? item : item.querySelector(rule.titleSelector);
        const linkEl = item.querySelector(rule.linkSelector);
        if (titleEl && linkEl && linkEl.href) {
          chapterLinks.push({ title: titleEl.textContent.trim(), url: linkEl.href });
        }
      });
    } else if (rule.tocLinkSelector) {
      // 使用 tocLinkSelector 模式
      const links = tocElement.querySelectorAll(rule.tocLinkSelector);
      links.forEach(link => {
        if (link.href && link.textContent.trim()) {
          chapterLinks.push({ title: link.textContent.trim(), url: link.href });
        }
      });
    }

    // 过滤掉无效的章节链接
    const validChapters = chapterLinks.filter(ch =>
      ch.title && ch.url &&
      ch.title.length > 1 && ch.title.length < 100 &&
      !ch.url.includes('javascript:') &&
      !ch.title.includes('更多') && !ch.title.includes('加载')
    );

    return validChapters.length >= MIN_MATCH_CHAPTERS ? validChapters.length : -1;
  } catch (e) {
    return -1;
  }
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

  // 3. 智能回退：尝试使用已有规则进行模糊匹配
  console.log('[站点检测] 未找到精确匹配规则，尝试智能回退匹配...');
  showToast('🔍 正在尝试匹配相似规则...', 'info', 2000);

  let bestMatch = null;
  let bestMatchCount = 0;

  for (const rule of allRules) {
    const chapterCount = tryExtractChapters(rule);
    if (chapterCount > bestMatchCount) {
      bestMatch = rule;
      bestMatchCount = chapterCount;
    }
  }

  if (bestMatch && bestMatchCount >= MIN_MATCH_CHAPTERS) {
    const ruleType = bestMatch.custom ? '自定义规则' : '内置规则';
    console.log(`[站点检测] ✅ 智能回退成功：使用 ${ruleType} - ${bestMatch.name}（匹配 ${bestMatchCount} 个章节）`);
    showToast(`✅ 自动匹配到相似规则：${bestMatch.name}`, 'success', 3000);
    return bestMatch;
  }

  console.warn('[站点检测] ❌ 智能回退失败，无法找到适用规则');
  showToast('⚠️ 未能识别当前站点，建议使用「规则管理」添加规则', 'warn', 4500);
  return SITE_SELECTORS[0];
}
