// ==UserScript==
// @name         笔趣阁下载器
// @namespace    http://tampermonkey.net/
// @version      0.9.14
// @description  可在笔趣阁下载小说（TXT格式）。
// @author       Licxisky
// @match        *://*/*
// @exclude      *://baidu.com/*
// @exclude      *://*.baidu.com/*
// @license      GPL-3.0
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @namespace    https://greasyfork.org/scripts/500170
// @supportURL   https://greasyfork.org/scripts/500170
// @homepageURL  https://greasyfork.org/scripts/500170
// @icon         https://www.beqege.cc/favicon.ico
// @connect       *
// ==/UserScript==

(function () {
  'use strict';

  // 配置管理模块
  // 功能：从 localStorage 加载/保存配置

  // 常量定义（消除魔法数字）
  const CONSTANTS = {
    IFRAME_CHECK_INTERVAL: 200,
    RETRY_BASE_DELAY: 1000,
    PROGRESS_SAVE_THROTTLE: 1000,
    PROGRESS_SAMPLE_SIZE: 10,
    PROGRESS_SAMPLE_MAX: 20,
    CONCURRENCY_MIN: 3,
    CONCURRENCY_MAX: 15,
    SLOW_RESPONSE_THRESHOLD: 3000,
    FAST_RESPONSE_THRESHOLD: 1000,
  };

  // 配置管理器
  const CONFIG = new Proxy({
    concurrency: parseInt(localStorage.getItem('bqg_concurrency') || '8'),
    maxRetries: parseInt(localStorage.getItem('bqg_maxRetries') || '3'),
    timeout: parseInt(localStorage.getItem('bqg_timeout') || '10'),
    minContentLength: parseInt(localStorage.getItem('bqg_minContentLength') || '50'),
    throttleMin: parseInt(localStorage.getItem('bqg_throttleMin') || '3'),
    throttleMax: parseInt(localStorage.getItem('bqg_throttleMax') || '15'),
    enablePreview: localStorage.getItem('bqg_enablePreview') !== 'false',
    previewCount: parseInt(localStorage.getItem('bqg_previewCount') || '3'),
    enableDetection: localStorage.getItem('bqg_enableDetection') !== 'false',
    duplicateThreshold: parseFloat(localStorage.getItem('bq_duplicateThreshold') || '0.85'),
    adThreshold: parseInt(localStorage.getItem('bqg_adThreshold') || '20'),
    disableResume: localStorage.getItem('bqg_disableResume') === 'true',
    maxTocPages: parseInt(localStorage.getItem('bqg_maxTocPages') || '10'),
    maxTocPagesHardLimit: 50,
    maxTotalChapters: 5000,
  }, {
    set(target, key, value) {
      target[key] = value;
      localStorage.setItem(`bqg_${key}`, value);
      return true;
    }
  });

  // HTTP 客户端模块
  // 功能：GM_xmlhttpRequest Promise 封装，绕过 CORS

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          onload: (response) => {
            const headersObj = {};
            if (response.responseHeaders) {
              const headerLines = response.responseHeaders.split('\r\n');
              for (const line of headerLines) {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                  const key = line.substring(0, colonIndex).trim();
                  const value = line.substring(colonIndex + 1).trim();
                  headersObj[key] = value;
                }
              }
            }

            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              statusText: response.statusText,
              url: response.finalUrl || response.responseURL,
              text: () => Promise.resolve(response.responseText),
              headers: headersObj,
              _rawHeaders: response.responseHeaders
            });
          },
          onerror: () => reject(new Error('GM_xmlhttpRequest 请求失败')),
          ontimeout: () => reject(new Error('GM_xmlhttpRequest 请求超时'))
        });
      } else {
        fetch(url).then(resolve).catch(reject);
      }
    });
  }

  // 站点选择器数据
  // 功能：内置站点配置

  const SITE_SELECTORS = [
    {
      name: 'beqege/bigee/bqgui',
      hostname: 'beqege.cc',
      toc: '#list',
      chapters: 'dl dd > a[href]',
      chaptersAlt: 'dl center.clear ~ dd > a[href]',
      content: ['div#content', '#chaptercontent', '.content'],
      title: '#maininfo #info h1',
      bookInfo: '#maininfo #info'
    },
    {
      name: 'listmain',
      hostname: 'bqgui.cc',
      toc: '.listmain',
      chapters: 'dl dd > a[href]',
      content: ['#chaptercontent', 'div#content', '.content'],
      title: '.info h1',
      bookInfo: 'div.book div.info'
    },
    {
      name: 'list-chapter',
      hostname: 'bqgui.cc',
      toc: '.list-chapter',
      chapters: 'div.booklist > ul > li > a[href]',
      content: ['.content', 'div#content', '#chaptercontent'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'biquge.net',
      hostname: 'biquge.net',
      toc: 'div.section-box',
      chapters: 'div.section-box ul.section-list li > a[href]',
      content: ['div.reader-main', 'div#content', '#chaptercontent', '.content', '#htmlContent'],
      title: 'h1',
      bookInfo: '#info, .book-info, .small'
    },
    {
      name: 'snapd.net',
      hostname: 'snapd.net',
      toc: 'dl',
      tocPattern: '最新章节列表',
      chapters: 'dl > dd > a[href*="/read/"]',
      content: ['#chaptercontent', 'div#content', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'alicesw.com',
      hostname: 'alicesw.com',
      toc: 'ul.mulu_list',
      chapters: 'ul.mulu_list > li > a[href]',
      content: ['.read-content', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: '3haitang.com',
      hostname: '3haitang.com',
      toc: 'ul',
      tocPattern: '最新章节列表',
      chapters: 'ul > li > a[href]',
      content: ['#content', '#htmlContent', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'shibashiwu.net',
      hostname: 'shibashiwu.net',
      toc: 'ul',
      tocPattern: '正文',
      chapters: 'ul > li > a[href]',
      content: ['#C0NTENT', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'hbdafeng.com',
      hostname: 'hbdafeng.com',
      toc: 'section.BCsectionTwo',
      tocPattern: '正文',
      chapters: 'ol.BCsectionTwo-top > li > a[href]',
      content: ['div.C0NTENT', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    }
  ];

  // 站点规则管理模块
  // 功能：管理站点选择器规则


  const SiteRuleManager = {
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

  // 站点检测模块
  // 功能：检测当前站点并匹配选择器策略


  // Toast 辅助函数
  function showToast$3(msg, type = 'success', duration = 2500) {
    // 简单实现，后续会被 ToastManager 替代
    console.log(`[${type}] ${msg}`);
  }

  function detectSiteStructure() {
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
    showToast$3('⚠️ 未能识别当前站点，建议使用「🎯 手动标记」功能设置规则', 'warn', 4500);
    return SITE_SELECTORS[0];
  }

  // 清洗规则管理模块
  // 功能：管理内容清洗正则规则

  const CleanRuleManager = {
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

  // 内容清洗模块
  // 功能：应用清洗规则移除垃圾内容


  // 获取启用的清洗规则
  let CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();

  function cleanContent(text) {
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

  // 智能限流模块
  // 功能：根据响应时间动态调整并发数


  let responseTimes = [];

  function adjustConcurrency() {
    if (responseTimes.length < CONSTANTS.PROGRESS_SAMPLE_SIZE) return;

    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const oldConcurrency = CONFIG.concurrency;

    if (avgTime > CONSTANTS.SLOW_RESPONSE_THRESHOLD && CONFIG.concurrency > CONFIG.throttleMin) {
      CONFIG.concurrency = Math.max(CONFIG.throttleMin, CONFIG.concurrency - 1);
      console.log(`[智能限流] 响应慢(${avgTime.toFixed(0)}ms)，降低并发: ${oldConcurrency} → ${CONFIG.concurrency}`);
    } else if (avgTime < CONSTANTS.FAST_RESPONSE_THRESHOLD && CONFIG.concurrency < CONFIG.throttleMax) {
      CONFIG.concurrency = Math.min(CONFIG.throttleMax, CONFIG.concurrency + 1);
      console.log(`[智能限流] 响应快(${avgTime.toFixed(0)}ms)，提升并发: ${oldConcurrency} → ${CONFIG.concurrency}`);
    }

    // 只保留最近的样本
    if (responseTimes.length > CONSTANTS.PROGRESS_SAMPLE_MAX) {
      responseTimes = responseTimes.slice(-CONSTANTS.PROGRESS_SAMPLE_MAX);
    }
  }

  // 规则分析器模块
  // 功能：智能分析页面结构，提取选择器规则

  const RuleAnalyzer = {
    analyzedRule: null,
    currentType: '',

    // 检测内容中的清洗 pattern
    detectCleanPatterns(contentEl) {
      if (!contentEl) return [];

      const content = contentEl.innerText;
      const detectedPatterns = [];

      // 常见顶级域名后缀
      const TLDS = ['com','net','org','cn','cc','io','la','xyz','tv','me','info','biz','top','vip','pro','tw','hk','uk','us','jp','co'];
      const tldPattern = TLDS.join('|');

      // 检测模式1: TLD锚定域名
      const domainRegex = new RegExp(`[a-z0-9]{2,}[^a-z\\u4e00-\\u9fa5\\r\\n]+(?:${tldPattern})\\b`, 'gi');
      const matches = content.match(domainRegex);

      if (matches && matches.length >= 2) {
        const freqMap = {};
        matches.forEach(m => {
          const normalized = m.toLowerCase().replace(/\s+/g, '');
          freqMap[normalized] = (freqMap[normalized] || 0) + 1;
        });

        const repeatedPatterns = Object.entries(freqMap).filter(([k, v]) => v >= 2);

        if (repeatedPatterns.length > 0 || matches.length >= 3) {
          detectedPatterns.push({
            type: 'domain_like',
            pattern: `[a-z0-9]{2,}[^a-z\\\\u4e00-\\\\u9fa5\\\\r\\\\n]+(?:${tldPattern})\\b`,
            description: `检测到疑似域名（出现${matches.length}次）`,
            confidence: matches.length >= 5 ? 'high' : 'medium',
            sample: matches.slice(0, 3).join(', ')
          });
        }
      }

      // 检测模式2: 重复英文短字符串
      const repeatedEnglishPattern = /\b([a-z]{3,10})\s+\1\s+\1\b/gi;
      const repeatedEnglish = content.match(repeatedEnglishPattern);
      if (repeatedEnglish && repeatedEnglish.length > 0) {
        detectedPatterns.push({
          type: 'repeated_words',
          pattern: '\\b([a-z]{3,10})\\s+\\1\\s+\\1\\b',
          description: `检测到重复的英文短语（${repeatedEnglish.length}处）`,
          confidence: 'high',
          sample: repeatedEnglish.slice(0, 2).join(', ')
        });
      }

      // 检测模式3: 重复中文短语
      const repeatedChinesePattern = /([\u4e00-\u9fa5]{2,4})\s*\1\s*\1/g;
      const repeatedChinese = content.match(repeatedChinesePattern);
      if (repeatedChinese && repeatedChinese.length > 0) {
        detectedPatterns.push({
          type: 'repeated_chinese',
          pattern: '([\\u4e00-\\u9fa5]{2,4})\\s*\\1\\s*\\1',
          description: `检测到重复的中文短语（${repeatedChinese.length}处）`,
          confidence: 'high',
          sample: repeatedChinese.slice(0, 2).join(', ')
        });
      }

      // 检测模式4: URL格式
      const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
      const urls = content.match(urlPattern);
      if (urls && urls.length > 0) {
        detectedPatterns.push({
          type: 'url',
          pattern: '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)',
          description: `检测到${urls.length}个URL`,
          confidence: 'high',
          sample: urls.slice(0, 2).join(', ')
        });
      }

      // 检测模式5: 站点推广文案
      const promoPatterns = [
        /本站推荐/g, /请记住本站域名/g, /最快更新/g, /一秒记住/g
      ];
      const promoMatches = promoPatterns.some(p => p.test(content));
      if (promoMatches) {
        detectedPatterns.push({
          type: 'promotion',
          pattern: '(本站推荐|请记住本站域名|最快更新|一秒记住).*?[。！]',
          description: '检测到站点推广文案',
          confidence: 'high',
          sample: '本站推荐、请记住本站域名等'
        });
      }

      return detectedPatterns;
    },

    // 分析章节目录页规则
    analyzeTocPage() {
      const result = {
        type: 'toc',
        domain: window.location.hostname,
        url: window.location.href,
        name: '',
        toc: '',
        chapters: '',
        title: '',
        bookInfo: '',
        confidence: {}
      };

      // 1. 提取站点名称
      result.name = document.title.split('-').pop()?.trim() || window.location.hostname;

      // 2. 分析目录容器
      const containers = ['#list', '.listmain', '.list-chapter', '#chapterlist', '.book-list', '.chapter-list', 'dl'];
      for (const selector of containers) {
        const el = document.querySelector(selector);
        if (el && el.querySelectorAll('a[href]').length > 10) {
          result.toc = selector;
          result.confidence.toc = 'high';
          break;
        }
      }

      // 3. 分析章节链接选择器
      if (result.toc) {
        const tocEl = document.querySelector(result.toc);
        const links = tocEl.querySelectorAll('a[href]');
        if (links.length > 0) {
          const firstLink = links[0];
          const parentTag = firstLink.parentElement.tagName.toLowerCase();
          if (parentTag === 'dd') result.chapters = 'dl dd > a[href]';
          else if (parentTag === 'li') result.chapters = 'ul > li > a[href], ol > li > a[href]';
          else result.chapters = 'a[href]';
          result.confidence.chapters = 'high';
        }
      }

      // 4. 分析标题选择器
      const titleSelectors = ['h1', '.title', '#title', 'h2', '.bookname'];
      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.trim().length > 0) {
          result.title = selector;
          result.confidence.title = 'high';
          break;
        }
      }

      // 5. 分析书籍信息容器
      const infoSelectors = ['#maininfo #info', '.book-info', '.info', '#info'];
      for (const selector of infoSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          result.bookInfo = selector;
          result.confidence.bookInfo = 'medium';
          break;
        }
      }

      this.analyzedRule = result;
      this.currentType = 'toc';
      return result;
    },

    // 检测目录页的分页信息
    detectTocPagination() {
      const result = {
        hasNextPage: false,
        nextPageSelector: '',
        nextPagePattern: '',
        paginationContainer: '',
        confidence: 'low'
      };

      // 辅助函数：检查链接是否有效
      const isValidNextPageLink = (link) => {
        if (!link || !link.href) return false;
        if (link.href.startsWith('javascript:') || link.href.startsWith('#')) return false;
        return true;
      };

      // 1. 尝试常见下一页选择器
      const commonSelectors = [
        'a.next-page', 'a.next', 'a[rel="next"]', '.pagination a.next',
        '.pager a.next', 'li.next a', '#next-page'
      ];

      for (const selector of commonSelectors) {
        const el = document.querySelector(selector);
        if (el && isValidNextPageLink(el)) {
          result.nextPageSelector = selector;
          result.hasNextPage = true;
          result.confidence = 'high';
          break;
        }
      }

      // 2. 文本匹配查找下一页
      if (!result.hasNextPage) {
        const allLinks = document.querySelectorAll('a');
        const nextPagePatterns = ['下一页', '下页', 'next'];
        for (const link of allLinks) {
          const text = link.innerText.trim().toLowerCase();
          if (nextPagePatterns.some(pattern => text.includes(pattern.toLowerCase()))) {
            if (isValidNextPageLink(link)) {
              result.nextPagePattern = link.innerText.trim();
              result.hasNextPage = true;
              result.confidence = 'medium';
              break;
            }
          }
        }
      }

      return result;
    },

    // 分析内容页规则
    analyzeContentPage() {
      const result = {
        type: 'content',
        domain: window.location.hostname,
        url: window.location.href,
        name: document.title.split('-').pop()?.trim() || window.location.hostname,
        content: [],
        nextPage: '',
        confidence: {}
      };

      // 1. 分析内容选择器
      const contentSelectors = [
        'div#content', '#chaptercontent', '.content', '#BookText',
        '.chapter-content', 'article', '.text-content', '.book-content'
      ];

      contentSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 100) {
          result.content.push(selector);
        }
      });

      if (result.content.length > 0) {
        result.confidence.content = 'high';
      }

      // 2. 分析下一页链接
      if (!result.nextPage) {
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          if (link.innerText.includes('下一页') || link.innerText === '下页') {
            if (link.className) {
              result.nextPage = `a.${link.className.split(' ')[0]}`;
            } else {
              result.nextPage = 'a';
            }
            result.confidence.nextPage = 'medium';
            break;
          }
        }
      }

      // 3. 智能检测清洗规则
      const contentEl = result.content.length > 0 ? document.querySelector(result.content[0]) : null;
      result.cleanPatterns = this.detectCleanPatterns(contentEl);
      result.confidence.cleanPatterns = result.cleanPatterns.length > 0 ? 'high' : 'low';

      this.analyzedRule = result;
      this.currentType = 'content';
      return result;
    },

    // 生成 HTML 报告
    generateReport(rule) {
      const confidenceColor = (conf) => {
        if (conf === 'high') return '#4caf50';
        if (conf === 'medium') return '#ff9800';
        return '#f44336';
      };

      const confidenceText = (conf) => {
        if (conf === 'high') return '高';
        if (conf === 'medium') return '中';
        return '低';
      };

      if (rule.type === 'toc') {
        return `
        <div style="margin-bottom:20px; padding:12px; background:#e3f2fd; border-radius:8px;">
          <div style="font-weight:600; color:#1976d2; margin-bottom:8px;">📊 章节目录规则分析</div>
          <div style="font-size:12px; color:#666;">域名: ${rule.domain}</div>
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">站点名称</span>
            <span style="padding:2px 8px; background:#4caf50; color:white; border-radius:12px; font-size:11px;">必需</span>
          </div>
          <input id="analyzedName" type="text" value="${rule.name}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">目录容器</span>
            <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.toc)}; color:white; border-radius:12px; font-size:11px;">可信度: ${confidenceText(rule.confidence.toc)}</span>
          </div>
          <input id="analyzedToc" type="text" value="${rule.toc}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">章节链接</span>
            <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.chapters)}; color:white; border-radius:12px; font-size:11px;">可信度: ${confidenceText(rule.confidence.chapters)}</span>
          </div>
          <input id="analyzedChapters" type="text" value="${rule.chapters}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">标题选择器</span>
            <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.title)}; color:white; border-radius:12px; font-size:11px;">可信度: ${confidenceText(rule.confidence.title)}</span>
          </div>
          <input id="analyzedTitle" type="text" value="${rule.title}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
        </div>
        <div style="padding:12px; background:#fff3cd; border-radius:8px; font-size:12px; color:#856404;">
          <strong>💡 提示：</strong>此规则用于目录页面，提取章节列表。请确认选择器准确后应用。
        </div>
      `;
      } else {
        return `
        <div style="margin-bottom:20px; padding:12px; background:#f3e5f5; border-radius:8px;">
          <div style="font-weight:600; color:#7b1fa2; margin-bottom:8px;">🔧 内容页规则分析</div>
          <div style="font-size:12px; color:#666;">域名: ${rule.domain}</div>
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">站点名称</span>
            <span style="padding:2px 8px; background:#4caf50; color:white; border-radius:12px; font-size:11px;">必需</span>
          </div>
          <input id="analyzedName" type="text" value="${rule.name}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">
        </div>
        <div style="margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; color:#333;">内容选择器（多个用逗号分隔）</span>
            <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.content)}; color:white; border-radius:12px; font-size:11px;">可信度: ${confidenceText(rule.confidence.content)}</span>
          </div>
          <input id="analyzedContent" type="text" value="${rule.content.join(', ')}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
        </div>
        <div style="padding:12px; background:#fff3cd; border-radius:8px; font-size:12px; color:#856404;">
          <strong>💡 提示：</strong>此规则用于内容页面，提取章节正文。
        </div>
      `;
      }
    },

    // 获取用户编辑后的规则
    getEditedRule() {
      if (this.currentType === 'toc') {
        return {
          name: document.getElementById('analyzedName').value,
          toc: document.getElementById('analyzedToc').value,
          chapters: document.getElementById('analyzedChapters').value,
          content: document.getElementById('analyzedContent') ?
            document.getElementById('analyzedContent').value.split(',').map(s => s.trim()).filter(s => s) :
            ['div#content', '#chaptercontent', '.content'],
          title: document.getElementById('analyzedTitle').value,
          bookInfo: document.getElementById('analyzedBookInfo')?.value || ''
        };
      } else {
        return {
          name: document.getElementById('analyzedName').value,
          content: document.getElementById('analyzedContent').value.split(',').map(s => s.trim()).filter(s => s),
          nextPage: document.getElementById('analyzedNextPage')?.value || '',
          cleanPatterns: this.analyzedRule?.cleanPatterns || []
        };
      }
    }
  };

  // 手动元素标记器模块
  // 功能：用户手动点选 DOM 元素生成选择器


  // Toast 辅助函数
  function showToast$2(msg, type = 'success', duration = 2500) {
    console.log(`[${type}] ${msg}`);
  }

  // 当前站点选择器（从外部传入）
  let currentSiteSelector$1 = null;

  const ElementPicker = {
    _mode: null,
    _picked: {},
    _toolbar: null,
    _menu: null,
    _highlight: null,
    _onComplete: null,
    _dragging: false,
    _currentElementPath: null,
    _currentSelectedElement: null,
    _outsideClickHandler: null,

    _modeTypes: {
      toc: [
        { key: 'toc', label: '📋 目录容器', desc: '包含所有章节链接的外层容器（必选）', required: true },
        { key: 'title', label: '📌 书名', desc: '显示书名的标题元素（必选）', required: true },
        { key: 'bookInfo', label: 'ℹ️ 书籍信息', desc: '作者/简介等信息区域（可选）', required: false }
      ],
      content: [
        { key: 'content', label: '📖 章节正文', desc: '当前章节的正文内容区域（必选）', required: true },
        { key: 'nextPage', label: '⏭️ 下一页', desc: '翻到下一页的链接按钮（可选）', required: false }
      ]
    },

    setCurrentSiteSelector(selector) {
      currentSiteSelector$1 = selector;
    },

    start(mode, onComplete) {
      this._mode = mode;
      this._picked = {};
      this._onComplete = onComplete || null;
      this._createToolbar();
      this._bindEvents();
      document.documentElement.classList.add('bqg-picker-mode');
      showToast$2(`🎯 已进入手动标记模式（${mode === 'toc' ? '目录页' : '内容页'}）`, 'info', 4000);
    },

    stop() {
      document.documentElement.classList.remove('bqg-picker-mode');
      this._removeMouseListeners();
      if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; }
      if (this._menu) { this._menu.remove(); this._menu = null; }
      if (this._outsideClickHandler) {
        document.removeEventListener('click', this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }
      this._clearHighlight();
      document.querySelectorAll('.bqg-picker-marked').forEach(el => el.classList.remove('bqg-picker-marked'));
      this._mode = null;
    },

    // 生成最紧凑的 CSS 选择器
    generateSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return 'body';

      if (el.id) {
        const escaped = CSS.escape(el.id);
        if (document.querySelectorAll('#' + escaped).length === 1) return '#' + el.id;
      }

      if (el.classList && el.classList.length > 0) {
        for (const cls of el.classList) {
          const sel = '.' + CSS.escape(cls);
          if (document.querySelectorAll(sel).length === 1) return '.' + cls;
        }
        const combined = '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(combined).length === 1) {
          return '.' + Array.from(el.classList).join('.');
        }
      }

      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        let parentSel = null;
        if (parent.id) {
          parentSel = '#' + parent.id;
        } else if (parent.classList && parent.classList.length > 0) {
          parentSel = parent.tagName.toLowerCase() + '.' + Array.from(parent.classList).join('.');
        }
        if (parentSel) {
          const composed = `${parentSel} > ${tag}`;
          if (document.querySelectorAll(composed).length <= 3) return composed;
        }
      }

      return tag;
    },

    _createToolbar() {
      if (this._toolbar) this._toolbar.remove();
      const types = this._modeTypes[this._mode] || [];
      const bar = document.createElement('div');
      bar.id = 'bqg-picker-toolbar';
      bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span id="bqg-picker-drag-handle">⠇</span>
        <span style="font-weight:700;font-size:13px;color:#fff;">🎯 手动标记（${this._mode === 'toc' ? '目录页' : '内容页'}）</span>
        <div id="bqg-picker-badges" style="display:flex;gap:8px;">
          ${types.map(t => `<span class="bqg-picker-badge" data-key="${t.key}">${t.label}${t.required ? ' <em style="color:#ffb74d;">*</em>' : ''}</span>`).join('')}
        </div>
        <div style="margin-left:auto;">
          <button id="bqg-picker-done" style="background:#43a047;color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;">✓ 完成</button>
          <button id="bqg-picker-cancel" style="background:#e53935;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;">✗ 取消</button>
        </div>
      </div>`;
      document.body.appendChild(bar);
      this._toolbar = bar;

      bar.querySelector('#bqg-picker-done').addEventListener('click', (e) => {
        e.stopPropagation();
        this.finish();
      });
      bar.querySelector('#bqg-picker-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        this.stop();
        showToast$2('已取消手动标记', 'info');
      });
    },

    _refreshBadges() {
      if (!this._toolbar) return;
      const types = this._modeTypes[this._mode] || [];
      types.forEach(t => {
        const badge = this._toolbar.querySelector(`.bqg-picker-badge[data-key="${t.key}"]`);
        if (!badge) return;
        if (this._picked[t.key]) {
          badge.classList.add('bqg-picker-badge-done');
        } else {
          badge.classList.remove('bqg-picker-badge-done');
        }
      });
    },

    _bindEvents() {
      this._onMouseMove = (e) => {
        if (this._dragging) return;
        const target = e.target;
        if (!target) return;
        if (target.closest('#bqg-picker-toolbar') || target.closest('#bqg-picker-menu')) return;
        this._clearHighlight();
        target.classList.add('bqg-picker-highlight');
        this._highlight = target;
      };
      this._onMouseClick = (e) => {
        if (this._dragging) return;
        const target = e.target;
        if (!target) return;
        if (target.closest('#bqg-picker-toolbar') || target.closest('#bqg-picker-menu')) return;
        e.preventDefault();
        e.stopPropagation();
        this._showMenu(target, e.clientX, e.clientY);
      };
      document.addEventListener('mouseover', this._onMouseMove, true);
      document.addEventListener('click', this._onMouseClick, true);
    },

    _removeMouseListeners() {
      if (this._onMouseMove) document.removeEventListener('mouseover', this._onMouseMove, true);
      if (this._onMouseClick) document.removeEventListener('click', this._onMouseClick, true);
    },

    _clearHighlight() {
      if (this._highlight) {
        this._highlight.classList.remove('bqg-picker-highlight');
        this._highlight = null;
      }
    },

    _showMenu(el, cx, cy) {
      if (this._outsideClickHandler) {
        document.removeEventListener('click', this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }

      if (this._menu) { this._menu.remove(); this._menu = null; }
      const types = this._modeTypes[this._mode] || [];

      const menu = document.createElement('div');
      menu.id = 'bqg-picker-menu';
      menu.innerHTML = `
      <div style="font-size:11px;color:#999;margin-bottom:8px;">${this.generateSelector(el)}</div>
      <div style="font-size:12px;color:#666;margin-bottom:10px;">请选择此元素的类型：</div>
      ${types.map(t => `<div class="bqg-picker-menu-item" data-key="${t.key}">${t.label}</div>`).join('')}
      <div class="bqg-picker-menu-item bqg-picker-menu-cancel">✗ 不标记</div>`;
      document.body.appendChild(menu);
      this._menu = menu;

      menu.style.left = (cx + 8) + 'px';
      menu.style.top = (cy + 8) + 'px';

      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.bqg-picker-menu-item');
        if (!item) return;
        e.stopPropagation();
        if (item.classList.contains('bqg-picker-menu-cancel')) {
          menu.remove(); this._menu = null;
          return;
        }

        const key = item.dataset.key;
        const sel = this.generateSelector(el);
        this._picked[key] = sel;

        if (key === 'toc') {
          const tocEl = document.querySelector(sel);
          if (tocEl) {
            const links = tocEl.querySelectorAll('a[href]');
            if (links.length > 0) {
              const parentTag = links[0].parentElement.tagName.toLowerCase();
              const chapSel = parentTag === 'dd' ? 'dl dd > a[href]' :
                              parentTag === 'li' ? 'ul > li > a[href]' :
                              `${sel} a[href]`;
              this._picked['chapters'] = chapSel;
            }
          }
        }

        el.classList.remove('bqg-picker-highlight');
        el.classList.add('bqg-picker-marked');
        menu.remove(); this._menu = null;
        this._refreshBadges();
      });
    },

    finish() {
      const types = this._modeTypes[this._mode] || [];
      const missing = types.filter(t => t.required && !this._picked[t.key]).map(t => t.label);
      if (missing.length > 0) {
        showToast$2(`⚠️ 请先标记必选项：${missing.join('、')}`, 'warn', 3500);
        return;
      }

      const currentHostname = window.location.hostname;
      let rule;

      if (this._mode === 'toc') {
        rule = {
          name: currentHostname,
          hostname: currentHostname,
          toc: this._picked.toc,
          chapters: this._picked.chapters || (this._picked.toc + ' a[href]'),
          content: ['div#content', '#chaptercontent', '.content'],
          title: this._picked.title,
          bookInfo: this._picked.bookInfo || ''
        };
      } else {
        const base = currentSiteSelector$1 || {};
        rule = {
          name: currentHostname,
          hostname: currentHostname,
          toc: base.toc || '',
          chapters: base.chapters || '',
          title: base.title || 'h1',
          bookInfo: base.bookInfo || '',
          content: [this._picked.content],
          nextPage: this._picked.nextPage || ''
        };
      }

      if (SiteRuleManager.addRule(rule)) {
        currentSiteSelector$1 = { ...rule, custom: true };
        this.stop();
        showToast$2(`✅ 规则已保存并立即生效！`, 'success', 3500);
        if (this._onComplete) this._onComplete(rule);
      } else {
        showToast$2('保存规则失败，请查看控制台（F12）', 'error');
      }
    }
  };

  // 内容抓取模块
  // 功能：从章节页抓取内容


  let currentSiteSelector = null;

  function setCurrentSiteSelector(selector) {
    currentSiteSelector = selector;
  }

  async function fetchContentWithIframe(url, contentSelector) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;

      let timeoutId;
      let checkInterval;

      const cleanup = () => {
        clearTimeout(timeoutId);
        clearInterval(checkInterval);
        iframe.src = 'about:blank';
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('iframe 加载超时'));
      }, CONFIG.timeout * 1000);

      iframe.onload = () => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

          checkInterval = setInterval(() => {
            const contentDiv = iframeDoc.querySelector(contentSelector[0]) ||
                               iframeDoc.querySelector(contentSelector[1]) ||
                               iframeDoc.querySelector(contentSelector[2]);

            if (contentDiv && contentDiv.innerText.trim().length > CONFIG.minContentLength) {
              cleanup();

              contentDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
              contentDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());
              contentDiv.innerHTML = contentDiv.innerHTML.replaceAll('<br>', '\n');

              const title = iframeDoc.querySelector('h1')?.innerText || '';
              const content = cleanContent(contentDiv.innerText);

              resolve({ title, content });
            }
          }, 200);

        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      iframe.onerror = () => {
        cleanup();
        reject(new Error('iframe 加载失败'));
      };

      document.body.appendChild(iframe);
    });
  }

  async function fetchContent(url, link) {
    let allContent = '';
    let title = '';

    async function fetchPage(pageUrl) {
      const response = await gmFetch(pageUrl);

      if (!response.ok) {
        const errorMsg = response.status === 404 ? '章节不存在(404)' :
                         response.status === 403 ? '访问被拒绝(403)' :
                         response.status === 503 ? '服务器现在无法处理请求(503)' :
                         response.status >= 500 ? `服务器错误(${response.status})` :
                         `HTTP 错误(${response.status})`;
        throw new Error(errorMsg);
      }

      const text = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      // 登录页面检测
      const isLoginPage = (() => {
        const finalUrl = response.url || pageUrl;
        if (/login|signin|auth/i.test(finalUrl)) return true;

        const loginForms = doc.querySelectorAll('form[action*="login"], form#login, .login-form, .signin-form, #loginForm');
        if (loginForms.length > 0) return true;

        const title = doc.title || '';
        if (/登录|登录页|请登录|用户登录/i.test(title)) return true;

        const hasLoginPrompt = /请先登录|需要登录|未登录|登录后阅读|登录后继续/i.test(text);
        const hasContentElement = currentSiteSelector?.content?.some(sel => doc.querySelector(sel));

        if (hasLoginPrompt && !hasContentElement) return true;

        if (response.url && response.url !== pageUrl && /login|signin|auth/i.test(response.url)) return true;

        return false;
      })();

      if (isLoginPage) {
        throw new Error('需要登录才能查看此章节');
      }

      // 使用站点配置的内容选择器
      let contentDiv = null;
      if (currentSiteSelector?.content) {
        for (const selector of currentSiteSelector.content) {
          contentDiv = doc.querySelector(selector);
          if (contentDiv) break;
        }
      }

      if (!contentDiv) {
        contentDiv = doc.querySelector('div#content') || doc.querySelector('#chaptercontent') || doc.querySelector('.content');
      }

      if (contentDiv) {
        contentDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
        contentDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());
        contentDiv.innerHTML = contentDiv.innerHTML.replaceAll('<br>', '\n');
        const extractedContent = contentDiv.innerText.trim();
        const cleanedContent = cleanContent(extractedContent);

        if (cleanedContent.length < CONFIG.minContentLength) {
          console.warn(`[异步加载检测] ${pageUrl} 内容过短，尝试使用 iframe`);
          try {
            const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector?.content || ['div#content']);
            allContent += iframeResult.content + '\n\n';
            if (!title && iframeResult.title) title = iframeResult.title;
            return;
          } catch (iframeError) {
            console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
            allContent += cleanedContent + '\n\n';
          }
        } else {
          allContent += cleanedContent + '\n\n';
        }
      } else {
        console.warn(`[异步加载检测] ${pageUrl} 未找到内容元素，尝试使用 iframe`);
        try {
          const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector?.content || ['div#content']);
          allContent += iframeResult.content + '\n\n';
          if (!title && iframeResult.title) title = iframeResult.title;
        } catch (iframeError) {
          console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
          throw new Error('无法获取章节内容（元素不存在且 iframe 加载失败）');
        }
      }

      if (doc.querySelector('h1')) {
        title = doc.querySelector('h1').innerText;
      }

      // 处理下一页
      const nextPage = doc.querySelector('.read-page a[href][rel="next"]');
      if (nextPage && nextPage.innerText === '下一页') {
        const nextUrl = nextPage.href.startsWith('http') ? nextPage.href : new URL(nextPage.href, pageUrl).href;
        await fetchPage(nextUrl);
      }
    }

    await fetchPage(url);

    if (link && !title) {
      title = link.innerText;
    }

    return { title, content: allContent };
  }

  // Promise Pool 并发控制模块
  // 功能：控制并发请求数量

  async function promisePool(tasks, concurrency) {
    const executing = [];

    for (const task of tasks) {
      const p = Promise.resolve(task()).then(result => {
        executing.splice(executing.indexOf(p), 1);
        return result;
      });

      executing.push(p);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  // 内容质量检测模块
  // 功能：检测内容重复、广告、异常等问题


  const ContentDetector = {
    // Simhash 算法：检测重复内容
    simhash(text) {
      const hash = new Array(64).fill(0);
      const words = text.match(/[\u4e00-\u9fa5]+/g) || [];

      words.forEach(word => {
        let wordHash = 0;
        for (let i = 0; i < word.length; i++) {
          wordHash = (wordHash * 31 + word.charCodeAt(i)) & 0xFFFFFFFF;
        }

        for (let i = 0; i < 64; i++) {
          const bit = (wordHash >> i) & 1;
          hash[i] += bit ? 1 : -1;
        }
      });

      return hash.map(v => v > 0 ? 1 : 0).join('');
    },

    // 计算汉明距离（相似度）
    similarity(hash1, hash2) {
      let distance = 0;
      for (let i = 0; i < 64; i++) {
        if (hash1[i] !== hash2[i]) distance++;
      }
      return 1 - distance / 64;
    },

    // 检测重复内容
    detectDuplicate(chapters) {
      const hashes = chapters.map(ch => ({
        index: ch.index,
        title: ch.title,
        hash: this.simhash(ch.content)
      }));

      const duplicates = [];
      for (let i = 0; i < hashes.length - 1; i++) {
        for (let j = i + 1; j < hashes.length; j++) {
          const sim = this.similarity(hashes[i].hash, hashes[j].hash);
          if (sim >= CONFIG.duplicateThreshold) {
            duplicates.push({
              chapter1: hashes[i].title,
              chapter2: hashes[j].title,
              similarity: (sim * 100).toFixed(1) + '%'
            });
          }
        }
      }
      return duplicates;
    },

    // 检测广告内容
    detectAds(content) {
      const adKeywords = [
        '推荐', '新书', '收藏', '投票', '月票', '打赏', '订阅',
        '关注', '公众号', '微信', 'QQ群', '书友群', '作者', '求',
        '跪求', '拜求', '官网', '最新章节', '最快更新', '首发'
      ];

      let adCount = 0;
      const words = content.match(/[\u4e00-\u9fa5]+/g) || [];
      words.forEach(word => {
        if (adKeywords.some(kw => word.includes(kw))) adCount++;
      });

      const adRatio = words.length > 0 ? (adCount / words.length) * 100 : 0;
      return {
        isAd: adRatio > CONFIG.adThreshold,
        ratio: adRatio.toFixed(1) + '%'
      };
    },

    // 检测异常内容
    detectAbnormal(content) {
      const issues = [];

      // 检测内容过短
      if (content.length < 100) {
        const snippet = content.trim().replace(/\s+/g, ' ').slice(0, 30);
        issues.push(snippet ? `内容过短: "${snippet}${content.trim().length > 30 ? '…' : ''}"` : '内容过短(空)');
      }

      // 检测乱码（连续特殊字符）
      if (/[^\u4e00-\u9fa5\w\s]{10,}/.test(content)) {
        issues.push('疑似乱码');
      }

      // 检测404或错误提示
      const strictErrorRe = /404|not\s*found|章节不存在/i;
      const looseErrorRe = /出错|错误/i;
      const useLoose = content.length < 100;

      if (strictErrorRe.test(content) || (useLoose && looseErrorRe.test(content))) {
        const combinedRe = useLoose
          ? /(.{0,10}(?:404|not\s*found|章节不存在|出错|错误).{0,10})/i
          : /(.{0,10}(?:404|not\s*found|章节不存在).{0,10})/i;
        const match = content.match(combinedRe);
        const snippet = match ? match[1].replace(/\s+/g, ' ').trim().slice(0, 25) : '';
        issues.push(snippet || '章节不存在或出错');
      }

      return issues;
    }
  };

  // 下载编排模块
  // 功能：协调整个下载流程


  // Toast 辅助函数
  function showToast$1(msg, type = 'success', duration = 2500) {
    console.log(`[${type}] ${msg}`);
  }

  const DownloadOrchestrator = {
    async downloadCurrentChapter(customContentSelector = null) {
      console.log('📖 [单章下载] 开始提取当前章节内容...');

      const siteConfig = detectSiteStructure();
      let contentDiv = null;

      if (customContentSelector) {
        contentDiv = document.querySelector(customContentSelector);
        if (contentDiv) console.log(`✅ 使用自定义选择器找到内容: ${customContentSelector}`);
      }

      if (!contentDiv) {
        for (const selector of siteConfig.content) {
          contentDiv = document.querySelector(selector);
          if (contentDiv && contentDiv.innerText.trim().length > 50) {
            console.log(`✅ 找到内容容器: ${selector}`);
            break;
          }
        }
      }

      if (!contentDiv) {
        const commonSelectors = ['div#content', '#chaptercontent', '.content', '#BookText', '.chapter-content', 'article', '.text-content', '.book-content'];
        for (const selector of commonSelectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 100) {
            contentDiv = el;
            console.log(`✅ 使用通用选择器找到内容: ${selector}`);
            break;
          }
        }
      }

      if (!contentDiv) {
        console.error('❌ [单章下载] 未找到内容元素');
        showToast$1('❌ 未找到章节内容元素', 'error');
        return;
      }

      let title = '';
      const titleSelectors = ['h1', '.title', '#title', 'h2', '.bookname', '.chapter-title'];
      for (const selector of titleSelectors) {
        const titleElement = document.querySelector(selector);
        if (titleElement && titleElement.innerText.trim()) {
          title = titleElement.innerText.trim();
          console.log(`✅ 找到标题 (${selector}): ${title}`);
          break;
        }
      }

      if (!title) {
        title = document.title.trim().split('-')[0];
        console.log(`⚠️ 未找到明确的标题元素，使用页面标题: ${title}`);
      }

      const clonedContentDiv = contentDiv.cloneNode(true);
      clonedContentDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
      clonedContentDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());
      clonedContentDiv.innerHTML = clonedContentDiv.innerHTML.replaceAll('<br>', '\n');

      const rawContent = clonedContentDiv.innerText;
      const cleanedContent = cleanContent(rawContent);
      clonedContentDiv.innerHTML = '';

      const contentLength = cleanedContent.length;
      console.log(`📊 [内容统计] 原始长度: ${rawContent.length}, 清洗后: ${contentLength}`);

      if (contentLength < CONFIG.minContentLength) {
        console.log('❌ [单章下载] 用户取消（内容过短）');
        return;
      }

      const fileContent = `${title}\n\n${cleanedContent}\n\n-----------------------\n下载链接：${document.URL}\n下载时间：${new Date().toLocaleString('zh-CN')}\n`;

      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.txt`;
      a.click();
      URL.revokeObjectURL(url);

      console.log(`✅ [单章下载] 完成: ${title}.txt (${contentLength}字)`);
      showToast$1(`✅ 已下载：${title}\n${contentLength}字`, 'success', 3000);
    },

    // 主下载函数
    async startDownload(options) {
      const {
        chapters,
        startIndex,
        finalIndex,
        booktitle,
        progressBar,
        onProgress,
        onComplete,
        onError
      } = options;

      setCurrentSiteSelector(options.siteSelector);

      const selectedLinks = Array.from(chapters).slice(startIndex, finalIndex + 1);
      const totalLinks = selectedLinks.length;
      let results = [];
      let completedRequests = 0;
      let failedChapters = [];
      let downloadStartTime = Date.now();

      // 断点续传检查
      let savedResults = [];
      if (!CONFIG.disableResume) {
        const progressKey = `bqg_progress_${booktitle}`;
        const savedProgress = localStorage.getItem(progressKey);
        if (savedProgress) {
          try {
            const progress = JSON.parse(savedProgress);
            if (progress.startIndex === startIndex && progress.finalIndex === finalIndex && progress.results) {
              savedResults = progress.results;
              completedRequests = progress.completedCount || 0;
            }
          } catch (e) {
            console.error('❌ 解析保存的进度失败:', e);
          }
        }
      }

      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

      const fetchAndParse = async (link, index, retryCount = 0) => {
        if (savedResults[index]) {
          console.log(`⏭️ [跳过章节#${index + 1}] ${link.innerText.trim()} (使用缓存)`);
          results[index] = savedResults[index];
          completedRequests++;
          if (onProgress) onProgress(index, completedRequests, totalLinks);
          return;
        }

        const url = link.href;
        const chapterTitle = link.innerText.trim();
        const requestStartTime = Date.now();

        console.log(`📥 [下载章节#${index + 1}] ${chapterTitle}`);

        try {
          results[index] = await fetchContent(url, link);

          const responseTime = Date.now() - requestStartTime;
          if (typeof adjustConcurrency === 'function') {
            // responseTimes 会由 fetchContent 内部管理
          }

          console.log(`✅ [下载成功#${index + 1}] ${chapterTitle} (${responseTime}ms)`);
        } catch (error) {
          if (error.name === 'AbortError') throw error;

          if (retryCount < CONFIG.maxRetries) {
            console.warn(`🔄 [重试章节#${index + 1}] 第 ${retryCount + 1}/${CONFIG.maxRetries} 次: ${chapterTitle}`);
            await delay(CONSTANTS.RETRY_BASE_DELAY * (retryCount + 1));
            return fetchAndParse(link, index, retryCount + 1);
          }

          console.error(`❌ [下载失败#${index + 1}] ${chapterTitle}: ${error.message}`);
          results[index] = { title: link.innerText, content: `抓取失败（已重试${CONFIG.maxRetries}次）: ${error.message}` };
          failedChapters.push({ index: index + startIndex + 1, title: link.innerText, error: error.message });
        } finally {
          completedRequests++;

          // 保存进度
          const now = Date.now();
          if (now - (this._lastSaveTime || 0) > CONSTANTS.PROGRESS_SAVE_THROTTLE || completedRequests === totalLinks) {
            const progressData = {
              startIndex,
              finalIndex,
              completedCount: completedRequests,
              totalLinks,
              totalChapters: chapters.length,
              results: results.filter(r => r)
            };
            localStorage.setItem(`bqg_progress_${booktitle}`, JSON.stringify(progressData));
            this._lastSaveTime = now;
          }

          if (onProgress) onProgress(index, completedRequests, totalLinks);
        }
      };

      const tasks = selectedLinks.map((link, index) => () => fetchAndParse(link, index));

      try {
        await promisePool(tasks, CONFIG.concurrency);

        // 下载完成
        localStorage.removeItem(`bqg_progress_${booktitle}`);

        if (onComplete) {
          onComplete({
            results,
            failedChapters,
            totalLinks,
            completedRequests,
            duration: (Date.now() - downloadStartTime) / 1000
          });
        }

        return { results, failedChapters };
      } catch (error) {
        if (onError) onError(error);
        throw error;
      }
    }
  };

  // ===== CSS: theme.css =====
  GM_addStyle(`/* UI 主题样式模块 */
/* 功能：集中管理所有 CSS 样式 */

/* ========== 布局常量 ========== */
/* 左右边距：24px，左右总边距：48px */

/* ========== 弹窗基础样式 ========== */

#fetchContentModal, #configModal, #ruleModal, #cleanRuleModal, #analyzerModal, #previewModal {
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  z-index: 10000;
  width: 520px;
  max-height: 90vh;
  overflow: hidden;
  animation: modalFadeIn 0.3s ease-out;
}

@keyframes modalFadeIn {
  from { opacity: 0; transform: translate(-50%, -48%); }
  to { opacity: 1; transform: translate(-50%, -50%); }
}

/* 弹窗特定宽度 */
#configModal { width: 460px; }
#ruleModal { width: 600px; }
#cleanRuleModal { width: 700px; }
#analyzerModal { width: 650px; }
#previewModal { width: 600px; }

/* 弹窗内容区域背景 */
#fetchContentModal::after, #configModal::after, #ruleModal::after,
#cleanRuleModal::after, #analyzerModal::after, #previewModal::after {
  content: '';
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  border-radius: 0 0 16px 16px;
  z-index: -1;
}

/* 弹窗标题 */
#fetchContentModal h3, #configModal h3, #ruleModal h3,
#cleanRuleModal h3, #analyzerModal h3, #previewModal h3 {
  margin: 0;
  padding: 20px 24px;
  font-size: 18px;
  font-weight: 600;
  color: white;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

/* 弹窗主体内容区 */
.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
}

/* 防止内容溢出 */
.modal-body * {
  box-sizing: border-box;
}

/* ========== 全局对齐容器 ========== */
/* 使用 .modal-content-wrapper 包裹需要对齐的内容，确保左右边距一致 */
.modal-body > div[style*="margin"],
.modal-body > label,
.modal-body > button,
.modal-body > table {
  margin-left: 0 !important;
  margin-right: 0 !important;
}

/* 关闭按钮 */
#fetcModalClose, #configModalClose, #ruleModalClose, #cleanRuleModalClose, #analyzerModalClose, #previewModalClose {
  cursor: pointer;
  float: right;
  margin: -2px 8px 0 0;
  width: 28px;
  height: 28px;
  line-height: 28px;
  text-align: center;
  border-radius: 8px;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.1);
}

#fetcModalClose:hover, #configModalClose:hover, #ruleModalClose:hover,
#cleanRuleModalClose:hover, #analyzerModalClose:hover, #previewModalClose:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: rotate(90deg);
}

/* 设置按钮 */
#configBtn {
  cursor: pointer;
  float: right;
  margin: -2px 8px 0 0;
  width: 32px;
  height: 28px;
  line-height: 28px;
  text-align: center;
  border-radius: 8px;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.1);
}

#configBtn:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ========== 表单元素样式 ========== */

label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  color: #333;
  font-weight: 500;
}

input[type="text"],
input[type="number"],
select {
  width: 100%;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: white;
}

/* 隐藏数字输入框的上下箭头 */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type="number"] {
  -moz-appearance: textfield;
}

input[type="text"]:focus,
input[type="number"]:focus,
select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  vertical-align: middle;
  margin-right: 8px;
}

small {
  font-size: 12px;
  color: #999;
  margin-left: 4px;
}

/* ========== 按钮样式 ========== */

button {
  border: none;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-family: inherit;
}

button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

button:active {
  transform: translateY(0);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* 主要按钮 - 渐变紫色 */
#fetchContentButton, #saveConfigButton {
  width: 100%;
  margin: 15px 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

#fetchContentButton:hover, #saveConfigButton:hover {
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
}

/* ========== 配置项样式 ========== */

.config-item {
  margin: 18px 0;
  padding: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.config-item label {
  display: inline-block;
  width: 120px;
  flex-shrink: 0;
  font-weight: 500;
  color: #333;
  text-align: left;
}

.config-item input[type="number"] {
  width: 70px;
  padding: 8px 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
  transition: all 0.3s ease;
  background: white;
  flex-shrink: 0;
}

.config-item input[type="number"]:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.config-item small {
  color: #999;
  margin-left: 8px;
  font-size: 12px;
  flex-shrink: 0;
}

/* ========== 按钮组容器 ========== */
/* 用于多个按钮并排的情况，确保左右对齐 */
.button-group {
  display: flex;
  gap: 10px;
  margin: 10px 0;
}

.button-group > button {
  flex: 1;
  min-width: 0;
}

/* 4个按钮的按钮组 */
.button-group-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 10px 0;
}

.button-group-4 > button {
  min-width: 0;
}

/* ========== 标题选择器组 ========== */
.title-selector-group {
  margin: 10px 0;
  padding: 12px;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 8px;
}

.title-selector-label {
  font-size: 12px;
  color: #667eea;
  font-weight: 600;
  display: block;
  margin-bottom: 8px;
}

.title-selector-group select {
  margin-bottom: 12px;
}

.title-selector-group input[type="text"] {
  margin-bottom: 0;
}

/* ========== 分隔线 ========== */
.section-divider {
  border-top: 1px solid #e0e0e0;
  padding-top: 16px;
  margin-top: 16px;
}

.config-item-border {
  border-top: 1px solid #e0e0e0;
  padding-top: 16px;
  margin-top: 16px;
}

/* ========== 标签样式 ========== */
.label-orange {
  color: #ff6f00;
}

.checkbox-label {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: #555;
}

.checkbox-label input[type="checkbox"] {
  margin-right: 8px;
}

/* ========== 缓存按钮网格 ========== */
.cache-buttons-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 10px;
}

/* ========== 提示框 ========== */
.tip-box {
  margin-bottom: 15px;
  padding: 12px;
  background: #fff3cd;
  border-radius: 8px;
  font-size: 12px;
  color: #856404;
}

/* ========== 检测结果 ========== */
.detection-title {
  font-size: 12px;
  color: #ff6f00;
  font-weight: 600;
  margin-bottom: 8px;
}

.failed-title {
  font-weight: bold;
  margin-bottom: 5px;
  color: #856404;
}

/* ========== 按钮变体 ========== */
.button-gray {
  background: #e0e0e0;
  color: #666;
}

/* ========== 管理按钮样式 ========== */
#manageCleanRulesButton {
  width: 100%;
  margin: 0 0 15px 0;
  background: linear-gradient(135deg, #ff9800 0%, #ff6f00 100%);
  color: white;
  padding: 12px;
  border-radius: 10px;
  font-size: 15px;
}

/* ========== 下载按钮组 ========== */
#previewButton, #ruleManageButton {
  flex: 1;
  min-width: 0;
  color: white;
  padding: 10px;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.3s ease;
}

#previewButton {
  background: linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%);
}

#ruleManageButton {
  background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
}

/* ========== 进度条样式 ========== */

#fetchContentProgress {
  background: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  margin: 15px 0;
  display: none;
  width: 100%;
}

#fetchContentProgress div {
  height: 28px;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  text-align: center;
  line-height: 28px;
  color: white;
  font-size: 13px;
  font-weight: 600;
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(102, 126, 234, 0.5);
  min-width: 0;
}

/* ========== 失败章节信息 ========== */

#failedChaptersInfo {
  margin: 15px 0;
  padding: 12px;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 8px;
  text-align: left;
  max-height: 150px;
  overflow-y: auto;
  overflow-x: hidden;
  width: 100%;
}

#failedChaptersList {
  font-size: 13px;
  color: #856404;
  margin: 8px 0;
}

#failedChaptersList div {
  padding: 4px 0;
  border-bottom: 1px dashed #e0a800;
}

#failedChaptersList div:last-child {
  border-bottom: none;
}

#retryFailedButton {
  width: 100%;
  margin-top: 10px;
  background: #ffc107;
  color: #333;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  border: none;
  font-size: 13px;
  transition: all 0.2s;
}

#retryFailedButton:hover {
  background: #ffb300;
}

/* ========== 检测结果容器 ========== */

#detectionResultsContainer {
  margin: 10px 0;
  padding: 12px;
  background: rgba(255, 152, 0, 0.1);
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
  overflow-x: hidden;
  display: none;
  width: 100%;
}

#detectionResults {
  font-size: 12px;
  color: #666;
}

/* ========== 隐藏下载链接 ========== */

#_downlink {
  display: none;
}

/* ========== Toast 通知 ========== */

@keyframes bqgToastIn {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.bqg-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  z-index: 99999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  white-space: pre-line;
  max-width: 420px;
  text-align: center;
  pointer-events: none;
  animation: bqgToastIn 0.2s ease-out;
  transition: opacity 0.3s ease;
}

.bqg-toast.success { background: #43a047; }
.bqg-toast.error { background: #e53935; }
.bqg-toast.info { background: #1976d2; }
.bqg-toast.warn { background: #f57c00; }

/* ========== 元素选择器样式 ========== */

html.bqg-picker-mode * { cursor: crosshair !important; }

.bqg-picker-highlight {
  outline: 2px dashed #667eea !important;
  outline-offset: 2px !important;
  background: rgba(102, 126, 234, 0.07) !important;
}

.bqg-picker-marked {
  outline: 2px solid #43a047 !important;
  outline-offset: 2px !important;
  background: rgba(67, 160, 71, 0.07) !important;
}

#bqg-picker-toolbar {
  position: fixed !important;
  top: 12px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 2147483647 !important;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  padding: 10px 16px 10px 12px !important;
  box-shadow: 0 4px 20px rgba(0,0,0,0.35) !important;
  border-radius: 12px !important;
  width: max-content !important;
  max-width: 92vw !important;
  user-select: none !important;
  color: white;
}

#bqg-picker-menu {
  position: fixed !important;
  z-index: 2147483646 !important;
  background: #fff !important;
  border-radius: 10px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22) !important;
  padding: 12px !important;
  min-width: 200px !important;
}

.bqg-picker-menu-item {
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #333 !important;
  margin-bottom: 4px;
  transition: background 0.15s;
}

.bqg-picker-menu-item:hover { background: #f0f4ff; }

.bqg-picker-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255,255,255,0.18);
  color: #fff;
  border-radius: 20px;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,0.3);
}

.bqg-picker-badge-done {
  background: rgba(67, 160, 71, 0.8) !important;
  border-color: #a5d6a7 !important;
}

/* ========== 缓存清除按钮 ========== */

.cache-clear-btn {
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: white;
  transition: all 0.2s;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  background: linear-gradient(135deg, #78909c 0%, #546e7a 100%);
}

.cache-clear-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  background: linear-gradient(135deg, #90a4ae 0%, #607d8b 100%);
}

.cache-clear-btn[data-type="progress"] {
  background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
}

.cache-clear-btn[data-type="progress"]:hover {
  background: linear-gradient(135deg, #64b5f6 0%, #2196f3 100%);
}

.cache-clear-btn[data-type="config"] {
  background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
}

.cache-clear-btn[data-type="config"]:hover {
  background: linear-gradient(135deg, #81c784 0%, #4caf50 100%);
}

.cache-clear-btn[data-type="rules"] {
  background: linear-gradient(135deg, #ffa726 0%, #fb8c00 100%);
}

.cache-clear-btn[data-type="rules"]:hover {
  background: linear-gradient(135deg, #ffb74d 0%, #ffa726 100%);
}

.cache-clear-btn[data-type="sites"] {
  background: linear-gradient(135deg, #ab47bc 0%, #8e24aa 100%);
}

.cache-clear-btn[data-type="sites"]:hover {
  background: linear-gradient(135deg, #ba68c8 0%, #9c27b0 100%);
}

#clearAllCacheButton {
  width: 100%;
  margin: 10px 0;
  padding: 12px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
}

/* ========== 章节范围表格 ========== */

table {
  width: 100%;
  margin: 0 0 20px 0;
  table-layout: fixed;
  border-collapse: collapse;
}

table th, table td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #666;
  font-size: 13px;
  padding: 0;
}

table input[type="number"] {
  width: 100%;
  box-sizing: border-box;
}

/* ========== 书名信息 ========== */

#_book_info {
  margin: 0 0 15px 0;
  padding: 12px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%);
  border-radius: 8px;
  font-weight: 500;
  color: #667eea;
  font-size: 14px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* ========== 规则列表样式 ========== */

#rulesList, #cleanRulesList {
  padding: 0;
  overflow-x: hidden;
}

#rulesList > div, #cleanRulesList > div {
  margin-bottom: 12px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
  overflow: hidden;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

#rulesList:empty::before, #cleanRulesList:empty::before {
  content: "暂无规则";
  display: block;
  text-align: center;
  color: #999;
  padding: 20px;
}

/* ========== 预览内容 ========== */

#previewContent {
  max-height: 50vh;
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.8;
  font-size: 14px;
  color: #333;
}

/* ========== 规则分析器内容 ========== */

#analyzerContent {
  max-height: 50vh;
  overflow-y: auto;
  font-size: 13px;
  color: #666;
  line-height: 1.8;
}

#analyzerContent code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}
`);

  const modalHtml = `
<div id="fetchContentModal" style="display:none;">
  <h3>小说下载工具<span id="fetcModalClose">✕</span><span id="configBtn" title="设置">⚙️</span></h3>
  <div class="modal-body">
    <label id="_book_info"></label>
    <div class="title-selector-group">
      <label class="title-selector-label">📚 文件名标题选择</label>
      <select id="_title_select">
        <option value="">自动检测（推荐）</option>
      </select>
      <input type="text" id="_title_custom" placeholder="或输入自定义标题">
    </div>
    <label for="ranges">下载章节范围：</label>
    <table>
      <tbody>
        <colgroup><col style="width: 45%;"><col style="width: 10%;"><col style="width: 45%;"></colgroup>
        <tr>
          <th style="width:45%; text-align:right;"><input type="number" id="_startRange" min="1" value="1"></th>
          <th style="width:10%; text-align:center;"> ~ </th>
          <th style="width:45%; text-align: left;"><input type="number" id="_finalRange" min="1" value="2"></th>
        </tr>
        <tr>
          <td style="width:45%; text-align:right;" id="_startRange_title"></td>
          <td style="width:10%; text-align:center;"> ~ </td>
          <td style="width:45%; text-align:left;" id="_finalRange_title"></td>
        </tr>
      </tbody>
    </table>
    <label id="_warn_info"></label>
    <div class="button-group">
      <button id="previewButton">📖 预览章节</button>
      <button id="ruleManageButton">⚙️ 规则管理</button>
    </div>
    <button id="fetchContentButton">开始下载</button>
    <div id="fetchContentProgress"><div></div></div>
    <div id="detectionResultsContainer" style="display:none;">
      <div class="detection-title">⚠️ 内容质量检测</div>
      <div id="detectionResults"></div>
    </div>
    <div id="failedChaptersInfo" style="display:none;">
      <div class="failed-title">失败章节列表：</div>
      <div id="failedChaptersList"></div>
      <button id="retryFailedButton">重试失败章节</button>
    </div>
    <a id="_downlink"></a>
  </div>
</div>
<div id="configModal" style="display:none;">
  <h3>下载设置<span id="configModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div class="config-item">
      <label>并发请求数</label>
      <input type="number" id="config_concurrency" min="1" max="20" value="8">
      <small>(1-20)</small>
    </div>
    <div class="config-item">
      <label>失败重试次数</label>
      <input type="number" id="config_retries" min="0" max="10" value="3">
      <small>(0-10)</small>
    </div>
    <div class="config-item">
      <label>iframe超时(秒)</label>
      <input type="number" id="config_timeout" min="5" max="60" value="10">
      <small>(5-60)</small>
    </div>
    <div class="config-item">
      <label>最小内容长度</label>
      <input type="number" id="config_minlength" min="10" max="200" value="50">
      <small>(10-200字)</small>
    </div>
    <div class="config-item config-item-border">
      <label class="label-orange">智能限流下限</label>
      <input type="number" id="config_throttle_min" min="1" max="20" value="3">
      <small>(1-20)</small>
    </div>
    <div class="config-item">
      <label class="label-orange">智能限流上限</label>
      <input type="number" id="config_throttle_max" min="1" max="30" value="15">
      <small>(1-30)</small>
    </div>
    <div class="section-divider">
      <button id="manageCleanRulesButton">🧹 内容清洗规则管理</button>
    </div>
    <div class="section-divider">
      <label class="checkbox-label">
        <input type="checkbox" id="config_disable_resume">
        <span>禁用断点续传（每次重新下载）</span>
      </label>
      <div class="cache-buttons-grid">
        <button class="cache-clear-btn" data-type="progress">📥 下载进度</button>
        <button class="cache-clear-btn" data-type="config">⚙️ 配置设置</button>
        <button class="cache-clear-btn" data-type="rules">📋 清洗规则</button>
        <button class="cache-clear-btn" data-type="sites">🌐 站点规则</button>
      </div>
      <button id="clearAllCacheButton">🗑️ 清除所有缓存数据</button>
    </div>
    <button id="saveConfigButton">保存设置</button>
  </div>
</div>
<div id="ruleModal" style="display:none;">
  <h3>站点规则管理<span id="ruleModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
    <div class="button-group">
      <button id="addRuleButton">➕ 添加规则</button>
      <button id="exportRulesButton">📤 导出</button>
      <button id="importRulesButton">📥 导入</button>
    </div>
    <div id="rulesList"></div>
  </div>
</div>
<div id="previewModal" style="display:none;">
  <h3>章节预览<span id="previewModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div id="previewContent" style="max-height: 50vh; overflow-y: auto; white-space: pre-wrap; line-height: 1.8; font-size: 14px;"></div>
    <div id="previewProgress" style="margin-top: 10px; color: #666;"></div>
  </div>
</div>
<div id="cleanRuleModal" style="display:none;">
  <h3>🧹 内容清洗规则管理<span id="cleanRuleModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
    <div class="tip-box">
      <strong>💡 提示：</strong>清洗规则使用正则表达式匹配并删除内容中的垃圾文本。内置规则可禁用，自定义规则可编辑删除。
    </div>
    <div class="button-group button-group-4">
      <button id="addCleanRuleButton">➕ 添加规则</button>
      <button id="importCleanRulesButton">📥 导入</button>
      <button id="exportCleanRulesButton">📤 导出</button>
      <button id="resetCleanRulesButton">🔄 重置</button>
    </div>
    <div id="cleanRulesList"></div>
  </div>
</div>
<div id="ruleAnalyzerModal" style="display:none;">
  <h3 id="analyzerModalTitle">智能规则分析<span id="analyzerModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div id="analyzerContent" style="max-height: 50vh; overflow-y: auto; font-size: 13px; color: #666; line-height: 1.8;"></div>
    <div class="button-group">
      <button id="applyRuleButton">✓ 应用规则</button>
      <button id="exportAnalyzedRuleButton">📤 导出规则</button>
      <button id="closeAnalyzerButton" class="button-gray">关闭</button>
    </div>
  </div>
</div>
`;

  // 模态框管理模块
  // 功能：创建和管理各种模态框


  // Toast 辅助函数
  function showToast(msg, type = 'success', duration = 2500) {
    const toast = document.createElement('div');
    toast.className = `bqg-toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 320);
    }, duration);
  }

  // 初始化模态框
  let elements = {};
  let state = {
    booktitle: null,
    tocDiv: null,
    chapters: null,
    currentSiteSelector: null,
    startIndex: 0,
    finalIndex: 0,
    results: [],
    selectedLinks: [],
    totalLinks: 0,
    completedRequests: 0,
    failedChapters: [],
    isDownloading: false,
    downloadStartTime: 0,
    lastSaveTime: 0,
    progressUpdateInterval: null
  };

  const ModalManager = {
    init() {
      // 插入模态框 HTML
      document.body.insertAdjacentHTML('beforeend', modalHtml);

      // 获取元素引用
      elements = {
        fetchContentModal: document.getElementById('fetchContentModal'),
        configModal: document.getElementById('configModal'),
        ruleModal: document.getElementById('ruleModal'),
        cleanRuleModal: document.getElementById('cleanRuleModal'),
        analyzerModal: document.getElementById('ruleAnalyzerModal'),
        previewModal: document.getElementById('previewModal'),
        startRangeInput: document.getElementById('_startRange'),
        finalRangeInput: document.getElementById('_finalRange'),
        startTitle: document.getElementById('_startRange_title'),
        finalTitle: document.getElementById('_finalRange_title'),
        fetchButton: document.getElementById('fetchContentButton'),
        progressBar: document.getElementById('fetchContentProgress')?.firstElementChild,
        downlink: document.getElementById('_downlink'),
        warnInfo: document.getElementById('_warn_info'),
        bookInfo: document.getElementById('_book_info'),
        titleSelect: document.getElementById('_title_select'),
        titleCustom: document.getElementById('_title_custom'),
        fetcClose: document.getElementById('fetcModalClose'),
        configBtn: document.getElementById('configBtn'),
        configModalClose: document.getElementById('configModalClose'),
        saveConfigButton: document.getElementById('saveConfigButton'),
        failedChaptersInfo: document.getElementById('failedChaptersInfo'),
        failedChaptersList: document.getElementById('failedChaptersList'),
        retryFailedButton: document.getElementById('retryFailedButton'),
        previewButton: document.getElementById('previewButton'),
        ruleManageButton: document.getElementById('ruleManageButton'),
        ruleModalClose: document.getElementById('ruleModalClose'),
        rulesList: document.getElementById('rulesList'),
        addRuleButton: document.getElementById('addRuleButton'),
        exportRulesButton: document.getElementById('exportRulesButton'),
        importRulesButton: document.getElementById('importRulesButton'),
        previewModalClose: document.getElementById('previewModalClose'),
        previewContent: document.getElementById('previewContent'),
        previewProgress: document.getElementById('previewProgress'),
        detectionResultsContainer: document.getElementById('detectionResultsContainer'),
        detectionResults: document.getElementById('detectionResults'),
        // 新增：清洗规则管理
        cleanRuleModalClose: document.getElementById('cleanRuleModalClose'),
        manageCleanRulesButton: document.getElementById('manageCleanRulesButton'),
        cleanRulesList: document.getElementById('cleanRulesList'),
        addCleanRuleButton: document.getElementById('addCleanRuleButton'),
        importCleanRulesButton: document.getElementById('importCleanRulesButton'),
        exportCleanRulesButton: document.getElementById('exportCleanRulesButton'),
        resetCleanRulesButton: document.getElementById('resetCleanRulesButton'),
        // 新增：缓存清除
        clearAllCacheButton: document.getElementById('clearAllCacheButton'),
        // 新增：规则分析器
        analyzerModalClose: document.getElementById('analyzerModalClose'),
        analyzerModalTitle: document.getElementById('analyzerModalTitle'),
        analyzerContent: document.getElementById('analyzerContent'),
        applyRuleButton: document.getElementById('applyRuleButton'),
        exportAnalyzedRuleButton: document.getElementById('exportAnalyzedRuleButton'),
        closeAnalyzerButton: document.getElementById('closeAnalyzerButton'),
        // 新增：断点续传选项
        configDisableResume: document.getElementById('config_disable_resume')
      };

      // 绑定关闭按钮
      elements.fetcClose.addEventListener('click', () => this.closeDownloadModal());
      elements.configModalClose.addEventListener('click', () => this.closeConfigModal());
      elements.configBtn.addEventListener('click', () => {
        this.closeDownloadModal();
        this.showConfigModal();
      });

      // 绑定保存配置按钮
      elements.saveConfigButton.addEventListener('click', () => this.saveConfig());

      // 绑定重试按钮
      elements.retryFailedButton.addEventListener('click', () => this.retryFailedChapters());

      // 绑定范围输入事件
      elements.startRangeInput.addEventListener('input', () => this.updateRangePreview());
      elements.finalRangeInput.addEventListener('input', () => this.updateRangePreview());

      // 绑定下载按钮
      elements.fetchButton.addEventListener('click', () => this.startDownload());

      // 绑定预览按钮
      elements.previewButton.addEventListener('click', () => this.showPreviewModal());

      // 绑定规则管理按钮
      elements.ruleManageButton.addEventListener('click', () => this.showRuleModal());

      // 绑定规则管理弹窗事件
      elements.ruleModalClose.addEventListener('click', () => this.closeRuleModal());
      elements.addRuleButton.addEventListener('click', () => this.addSiteRule());
      elements.exportRulesButton.addEventListener('click', () => SiteRuleManager.exportRules());
      elements.importRulesButton.addEventListener('click', () => this.importSiteRules());

      // 绑定预览弹窗事件
      elements.previewModalClose.addEventListener('click', () => this.closePreviewModal());

      // 绑定清洗规则管理按钮
      elements.manageCleanRulesButton.addEventListener('click', () => this.showCleanRuleModal());
      elements.cleanRuleModalClose.addEventListener('click', () => this.closeCleanRuleModal());
      elements.addCleanRuleButton.addEventListener('click', () => this.addCleanRule());
      elements.importCleanRulesButton.addEventListener('click', () => this.importCleanRules());
      elements.exportCleanRulesButton.addEventListener('click', () => CleanRuleManager.exportRules());
      elements.resetCleanRulesButton.addEventListener('click', () => this.resetCleanRules());

      // 绑定缓存清除按钮
      document.querySelectorAll('.cache-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => this.clearCacheByType(btn.dataset.type));
      });
      elements.clearAllCacheButton.addEventListener('click', () => this.clearCacheByType('all'));

      // 绑定规则分析器弹窗事件
      elements.analyzerModalClose.addEventListener('click', () => this.closeAnalyzerModal());
      elements.applyRuleButton.addEventListener('click', () => this.applyAnalyzedRule());
      elements.exportAnalyzedRuleButton.addEventListener('click', () => this.exportAnalyzedRule());
      elements.closeAnalyzerButton.addEventListener('click', () => this.closeAnalyzerModal());
    },

    showDownloadModal() {
      if (!elements.fetchContentModal) this.init();

      // 检测站点结构
      state.currentSiteSelector = detectSiteStructure();
      state.tocDiv = document.querySelector(state.currentSiteSelector.toc);

      if (!state.tocDiv) {
        showToast('未能识别站点结构，请联系开发者添加支持', 'error', 5000);
        return;
      }

      // 获取章节列表
      this.loadChapters();

      // 更新标题选项
      this.updateTitleSelect();

      // 显示模态框
      elements.fetchContentModal.style.display = 'flex';

      // 隐藏下载按钮
      const btn = document.querySelector('button#downloadMenuBtn');
      if (btn) btn.hidden = true;
    },

    closeDownloadModal() {
      if (elements.fetchContentModal) {
        elements.fetchContentModal.style.display = 'none';
      }
      // 恢复下载按钮显示
      const btn = document.querySelector('button#downloadMenuBtn');
      if (btn) btn.hidden = false;
    },

    showConfigModal() {
      if (!elements.configModal) this.init();

      // 填充当前配置
      document.getElementById('config_concurrency').value = CONFIG.concurrency;
      document.getElementById('config_retries').value = CONFIG.maxRetries;
      document.getElementById('config_timeout').value = CONFIG.timeout;
      document.getElementById('config_minlength').value = CONFIG.minContentLength;
      document.getElementById('config_throttle_min').value = CONFIG.throttleMin;
      document.getElementById('config_throttle_max').value = CONFIG.throttleMax;
      elements.configDisableResume.checked = CONFIG.disableResume || false;

      elements.configModal.style.display = 'flex';
    },

    closeConfigModal() {
      if (elements.configModal) {
        elements.configModal.style.display = 'none';
      }
    },

    saveConfig() {
      CONFIG.concurrency = parseInt(document.getElementById('config_concurrency').value);
      CONFIG.maxRetries = parseInt(document.getElementById('config_retries').value);
      CONFIG.timeout = parseInt(document.getElementById('config_timeout').value);
      CONFIG.minContentLength = parseInt(document.getElementById('config_minlength').value);
      CONFIG.throttleMin = parseInt(document.getElementById('config_throttle_min').value);
      CONFIG.throttleMax = parseInt(document.getElementById('config_throttle_max').value);
      CONFIG.disableResume = elements.configDisableResume.checked;

      this.closeConfigModal();
      showToast('✅ 配置已保存', 'success');
    },

    loadChapters() {
      // 检测是否需要分页加载
      const needsPagination = this.detectPaginationNeeded(state.currentSiteSelector);

      if (needsPagination) {
        showToast('检测到分页，正在加载所有章节...', 'info');
        this.loadPaginatedChapters();
      } else {
        this.loadSinglePageChapters();
      }
    },

    detectPaginationNeeded(selector) {
      // 简化检测：检查是否有明显的下一页链接
      // 先尝试 CSS 类选择器
      let nextPage = document.querySelector('a.next-page, a.next, a[rel="next"]');
      if (!nextPage) {
        // 如果没有找到，遍历所有链接查找文本内容
        const links = document.querySelectorAll('a');
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          if (text === '下一页' || text === '下页' || text === '下一章' || text === '下1页') {
            nextPage = link;
            break;
          }
        }
      }
      return nextPage && selector.chapters && document.querySelectorAll(selector.chapters).length < 100;
    },

    loadSinglePageChapters() {
      if (state.currentSiteSelector.chaptersAlt && state.tocDiv.querySelector('dl center.clear')) {
        state.chapters = document.querySelectorAll(state.currentSiteSelector.chaptersAlt);
      } else {
        state.chapters = document.querySelectorAll(state.currentSiteSelector.chapters);
      }

      if (!state.chapters.length) {
        showToast('未找到章节列表，请检查页面结构', 'error', 5000);
        return;
      }

      // 章节去重
      const seenUrls = new Set();
      const uniqueChapters = [];
      for (const chapter of state.chapters) {
        const href = chapter.getAttribute('href');
        if (href && !seenUrls.has(href)) {
          seenUrls.add(href);
          uniqueChapters.push(chapter);
        }
      }
      state.chapters = uniqueChapters;

      this.updateChapterRange();
    },

    updateChapterRange() {
      state.startIndex = 0;
      state.finalIndex = state.chapters.length - 1;

      elements.startRangeInput.max = state.chapters.length;
      elements.finalRangeInput.max = state.chapters.length;

      elements.finalRangeInput.value = state.chapters.length;
      elements.startTitle.textContent = state.chapters[state.startIndex].textContent;
      elements.finalTitle.textContent = state.chapters[state.finalIndex].textContent;

      // 更新书名信息
      if (!state.booktitle) state.booktitle = document.title;
      elements.bookInfo.textContent = `当前小说：《${state.booktitle}》，共 ${state.chapters.length} 章。`;

      elements.warnInfo.textContent = '设置范围后点击开始下载，并稍作等待。若章节过多下载卡住，可尝试减小章节范围分次下载。';
    },

    updateRangePreview() {
      const start = parseInt(elements.startRangeInput.value) - 1;
      const final = parseInt(elements.finalRangeInput.value) - 1;

      if (start >= 0 && start < state.chapters.length) {
        elements.startTitle.textContent = state.chapters[start].textContent;
      }
      if (final >= 0 && final < state.chapters.length) {
        elements.finalTitle.textContent = state.chapters[final].textContent;
      }
    },

    async startDownload() {
      if (state.isDownloading) {
        showToast('正在下载中，请稍候...', 'info');
        return;
      }

      // 获取下载范围
      const startValue = parseInt(elements.startRangeInput.value) || 1;
      const finalValue = parseInt(elements.finalRangeInput.value) || state.chapters.length;
      state.startIndex = startValue - 1;
      state.finalIndex = Math.min(finalValue - 1, state.chapters.length - 1);

      if (state.startIndex < 0 || state.finalIndex >= state.chapters.length || state.startIndex > state.finalIndex) {
        showToast('章节范围无效，请检查', 'error');
        return;
      }

      // 获取书名
      const titleSelectValue = elements.titleSelect.value;
      const titleCustomValue = elements.titleCustom.value.trim();
      let filename = state.booktitle || '小说';
      if (titleCustomValue) {
        filename = titleCustomValue;
      } else if (titleSelectValue) {
        filename = titleSelectValue;
      }

      state.isDownloading = true;
      state.failedChapters = [];
      state.results = [];
      state.downloadStartTime = Date.now();

      // 重置UI
      elements.failedChaptersInfo.style.display = 'none';
      elements.fetchButton.disabled = true;
      elements.fetchButton.textContent = '下载中...';

      // 显示进度条
      if (elements.progressBar) {
        elements.progressBar.style.width = '0%';
        elements.progressBar.parentElement.style.display = 'block';
      }

      showToast(`开始下载 ${state.finalIndex - state.startIndex + 1} 个章节...`, 'info');

      try {
        await DownloadOrchestrator.startDownload({
          chapters: state.chapters,
          startIndex: state.startIndex,
          finalIndex: state.finalIndex,
          booktitle: filename,
          siteSelector: state.currentSiteSelector,
          onProgress: (index, completed, total) => {
            const percent = Math.round((completed / total) * 100);
            if (elements.progressBar) {
              elements.progressBar.style.width = `${percent}%`;
              elements.progressBar.textContent = `${percent}%`;
            }
            elements.warnInfo.textContent = `正在下载: ${completed}/${total} (${percent}%)`;
          },
          onComplete: (result) => {
            this.handleDownloadComplete(result, filename);
          },
          onError: (error) => {
            console.error('下载出错:', error);
            showToast(`下载出错: ${error.message}`, 'error');
          }
        });
      } catch (error) {
        console.error('下载失败:', error);
        showToast(`下载失败: ${error.message}`, 'error');
      } finally {
        state.isDownloading = false;
        elements.fetchButton.disabled = false;
        elements.fetchButton.textContent = '开始下载';
      }
    },

    handleDownloadComplete(result, filename) {
      const { results, failedChapters, totalLinks, completedRequests, duration } = result;

      // 保存结果和章节链接供重试使用
      state.results = results;
      state.selectedLinks = Array.from(state.chapters).slice(state.startIndex, state.finalIndex + 1);

      // 生成文件内容
      let content = '';
      results.forEach((item, index) => {
        if (item && item.title && item.content) {
          content += `${item.title}\n\n${item.content}\n\n`;
        }
      });

      // 添加结尾信息
      content += `-----------------------\n`;
      content += `总章节数: ${totalLinks}\n`;
      content += `成功下载: ${completedRequests - failedChapters.length}\n`;
      content += `失败章节: ${failedChapters.length}\n`;
      content += `下载耗时: ${duration.toFixed(1)} 秒\n`;
      content += `下载时间: ${new Date().toLocaleString('zh-CN')}\n`;

      // 触发下载
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      elements.downlink.href = url;
      elements.downlink.download = `${filename}.txt`;
      elements.downlink.click();
      URL.revokeObjectURL(url);

      // 更新UI
      elements.warnInfo.textContent = `✅ 下载完成！成功 ${completedRequests - failedChapters.length}/${totalLinks}，耗时 ${duration.toFixed(1)}秒`;
      showToast(`下载完成！${completedRequests - failedChapters.length}/${totalLinks} 成功`, 'success', 3000);

      // 显示失败章节列表
      if (failedChapters.length > 0) {
        state.failedChapters = failedChapters;
        const failedListHtml = failedChapters.map(f => `<div>第 ${f.index} 章: ${f.title}</div>`).join('');
        elements.failedChaptersList.innerHTML = failedListHtml;
        elements.failedChaptersInfo.style.display = 'block';
      }
    },

    async retryFailedChapters() {
      if (state.failedChapters.length === 0) return;

      // 保存原始失败列表
      const originalFailed = [...state.failedChapters];
      state.failedChapters = [];

      // 更新 UI
      elements.failedChaptersInfo.style.display = 'none';
      if (elements.progressBar) {
        elements.progressBar.parentElement.style.display = 'block';
      }

      showToast(`开始重试 ${originalFailed.length} 个失败章节...`, 'info');

      try {
        // 对每个失败章节进行重试
        for (const failed of originalFailed) {
          const chapterIndex = failed.index - 1; // 转换为 0-based
          if (chapterIndex < 0 || chapterIndex >= state.chapters.length) continue;

          const link = state.chapters[chapterIndex];
          elements.warnInfo.textContent = `正在重试: ${failed.title}`;

          try {
            const result = await DownloadOrchestrator.startDownload({
              chapters: [link],
              startIndex: 0,
              finalIndex: 0,
              booktitle: 'retry',
              siteSelector: state.currentSiteSelector,
              onProgress: () => {},
              onComplete: () => {},
              onError: () => {}
            });

            if (result.results && result.results[0]) {
              // 更新结果
              if (!state.results) state.results = [];
              state.results[chapterIndex] = result.results[0];
            }
          } catch (error) {
            // 重试仍然失败，加入失败列表
            state.failedChapters.push(failed);
            console.error(`重试失败: ${failed.title}`, error);
          }
        }

        // 重试完成
        if (state.failedChapters.length === 0) {
          // 全部成功，重新生成下载文件
          showToast('✅ 所有章节重试成功！', 'success', 3000);
          // 重新生成下载文件
          this.regenerateDownloadFile();
        } else {
          // 仍有失败，显示失败列表
          const failedListHtml = state.failedChapters.map(f => `<div>第 ${f.index} 章: ${f.title}</div>`).join('');
          elements.failedChaptersList.innerHTML = failedListHtml;
          elements.failedChaptersInfo.style.display = 'block';
          showToast(`重试完成，${state.failedChapters.length}/${originalFailed.length} 仍然失败`, 'warn', 3000);
        }
      } catch (error) {
        console.error('重试过程出错:', error);
        showToast(`重试出错: ${error.message}`, 'error');
      }
    },

    regenerateDownloadFile() {
      if (!state.results || state.results.length === 0) return;

      const totalLinks = state.finalIndex - state.startIndex + 1;
      const successCount = state.results.filter(r => r).length;

      // 生成文件内容
      let content = '';
      state.results.forEach((item, index) => {
        if (item && item.title && item.content) {
          content += `${item.title}\n\n${item.content}\n\n`;
        }
      });

      // 添加结尾信息
      content += `-----------------------\n`;
      content += `总章节数: ${totalLinks}\n`;
      content += `成功下载: ${successCount}\n`;
      content += `下载时间: ${new Date().toLocaleString('zh-CN')}\n`;

      // 获取文件名
      const titleSelectValue = elements.titleSelect.value;
      const titleCustomValue = elements.titleCustom.value.trim();
      let filename = state.booktitle || '小说';
      if (titleCustomValue) {
        filename = titleCustomValue;
      } else if (titleSelectValue) {
        filename = titleSelectValue;
      }

      // 触发下载
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      elements.downlink.href = url;
      elements.downlink.download = `${filename}.txt`;
      elements.downlink.click();
      URL.revokeObjectURL(url);

      elements.warnInfo.textContent = `✅ 重试完成！所有章节已下载，共 ${successCount} 章`;
    },

    // ========== 规则管理弹窗 ==========

    showRuleModal() {
      if (!elements.ruleModal) this.init();
      this.renderRulesList();
      elements.ruleModal.style.display = 'flex';
    },

    closeRuleModal() {
      if (elements.ruleModal) {
        elements.ruleModal.style.display = 'none';
      }
    },

    renderRulesList() {
      const allRules = SiteRuleManager.getAllRules();
      const html = allRules.map(rule => `
      <div style="margin-bottom:12px; padding:12px; background:#f9f9f9; border-radius:8px; ${rule.custom ? 'border-left:3px solid #66bb6a;' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1;">
            <div style="font-weight:600; color:#333; margin-bottom:4px;">${rule.name}${rule.custom ? ' <span style="font-size:10px; color:#66bb6a;">[自定义]</span>' : ' <span style="font-size:10px; color:#999;">[内置]</span>'}</div>
            <div style="font-size:11px; color:#999;">目录: ${rule.toc} | 标题: ${rule.title || '未设置'}</div>
          </div>
          ${rule.custom ? `<button data-rule-id="${rule.id}" class="bqg-delete-rule-btn" style="background:#f44336; color:white; padding:6px 12px; border-radius:4px; font-size:11px; cursor:pointer; border:none;">删除</button>` : ''}
        </div>
      </div>
    `).join('');

      elements.rulesList.innerHTML = html || '<div style="text-align:center; color:#999; padding:20px;">暂无规则</div>';

      // 绑定删除按钮事件
      elements.rulesList.querySelectorAll('.bqg-delete-rule-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ruleId = e.target.getAttribute('data-rule-id');
          this.deleteSiteRule(ruleId);
        });
      });
    },

    deleteSiteRule(ruleId) {
      if (confirm('确定删除此规则？')) {
        if (SiteRuleManager.deleteRule(ruleId)) {
          this.renderRulesList();
          showToast('✅ 删除成功', 'success');
        } else {
          showToast('删除失败', 'error');
        }
      }
    },

    addSiteRule() {
      const name = prompt('规则名称（如：某某小说网）:');
      if (!name) return;

      const toc = prompt('目录选择器（CSS Selector）:');
      if (!toc) return;

      const chapters = prompt('章节选择器（CSS Selector）:');
      if (!chapters) return;

      const content = prompt('内容选择器（CSS Selector）:');
      if (!content) return;

      const title = prompt('标题选择器（CSS Selector，可选）:') || '';

      if (SiteRuleManager.addRule({ name, toc, chapters, content, title })) {
        this.renderRulesList();
        showToast('✅ 添加成功', 'success');
      } else {
        showToast('添加失败', 'error');
      }
    },

    importSiteRules() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          if (SiteRuleManager.importRules(event.target.result)) {
            this.renderRulesList();
            showToast('✅ 导入成功', 'success');
          } else {
            showToast('导入失败，请检查文件格式', 'error');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    },

    // ========== 章节预览功能 ==========

    async showPreviewModal() {
      if (!elements.previewModal) this.init();

      const previewCount = CONFIG.previewCount || 3;
      const startValue = parseInt(elements.startRangeInput.value) || 1;
      const startIndex = Math.max(0, startValue - 1);

      // 选择预览的章节
      const chaptersToPreview = Array.from(state.chapters).slice(startIndex, startIndex + previewCount);

      if (chaptersToPreview.length === 0) {
        showToast('没有可预览的章节', 'warn');
        return;
      }

      elements.previewContent.innerHTML = '';
      elements.previewProgress.textContent = '正在加载...';
      elements.previewModal.style.display = 'flex';

      try {
        for (let i = 0; i < chaptersToPreview.length; i++) {
          const link = chaptersToPreview[i];
          elements.previewProgress.textContent = `正在加载 ${i + 1}/${chaptersToPreview.length}: ${link.textContent}`;

          const result = await DownloadOrchestrator.startDownload({
            chapters: [link],
            startIndex: 0,
            finalIndex: 0,
            booktitle: 'preview',
            siteSelector: state.currentSiteSelector,
            onProgress: () => {},
            onComplete: () => {},
            onError: () => {}
          });

          if (result.results && result.results[0]) {
            const { title, content } = result.results[0];
            const previewItem = document.createElement('div');
            previewItem.style.marginBottom = '20px';
            previewItem.style.paddingBottom = '15px';
            previewItem.style.borderBottom = '1px dashed #ddd';
            previewItem.innerHTML = `
            <div style="font-weight:bold; color:#333; margin-bottom:8px;">${title}</div>
            <div style="color:#666; white-space:pre-wrap; line-height:1.8;">${content.substring(0, 500)}${content.length > 500 ? '...' : ''}</div>
          `;
            elements.previewContent.appendChild(previewItem);
          }
        }

        elements.previewProgress.textContent = `预览完成 (${chaptersToPreview.length} 章)`;
      } catch (error) {
        elements.previewProgress.textContent = `加载失败: ${error.message}`;
        showToast(`预览失败: ${error.message}`, 'error');
      }
    },

    closePreviewModal() {
      if (elements.previewModal) {
        elements.previewModal.style.display = 'none';
      }
    },

    // ========== 分页章节加载 ==========

    async loadPaginatedChapters() {
      showToast('正在加载所有分页章节...', 'info');

      const allChapters = Array.from(state.chapters || []);
      const processedUrls = new Set(allChapters.map(c => c.getAttribute('href')));

      try {
        // 查找下一页链接
        let nextPageUrl = this.findNextPageUrl();
        let pageCount = 0;
        const maxPages = 50; // 防止无限循环

        while (nextPageUrl && pageCount < maxPages) {
          pageCount++;
          elements.warnInfo.textContent = `正在加载第 ${pageCount + 1} 页...`;

          // 使用 gmFetch 获取下一页
          const response = await gmFetch(nextPageUrl);
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          // 提取章节列表
          const pageChapters = doc.querySelectorAll(state.currentSiteSelector.chapters);
          let newCount = 0;

          pageChapters.forEach(chapter => {
            const href = chapter.getAttribute('href');
            // 处理相对路径
            const fullUrl = href.startsWith('http') ? href : new URL(href, nextPageUrl).href;

            if (!processedUrls.has(fullUrl)) {
              processedUrls.add(fullUrl);
              // 修正 href 为绝对路径
              chapter.setAttribute('href', fullUrl);
              allChapters.push(chapter);
              newCount++;
            }
          });

          if (newCount === 0) {
            console.log('没有新章节，停止加载');
            break;
          }

          // 在新页面中查找下一页链接
          const baseElement = doc.createElement('base');
          baseElement.href = nextPageUrl;
          doc.head.appendChild(baseElement);

          nextPageUrl = this.findNextPageUrlInDoc(doc);
        }

        state.chapters = allChapters;
        this.updateChapterRange();

        showToast(`✅ 加载完成，共 ${allChapters.length} 章`, 'success');
      } catch (error) {
        console.error('分页加载失败:', error);
        showToast(`分页加载失败: ${error.message}`, 'error');
        // 降级使用已加载的章节
        if (allChapters.length > 0) {
          state.chapters = allChapters;
          this.updateChapterRange();
        }
      }
    },

    findNextPageUrl() {
      // 在当前页面查找下一页链接
      const nextButtons = document.querySelectorAll('a');
      for (const btn of nextButtons) {
        const text = btn.textContent.trim();
        if (text === '下一页' || text === '下页' || text === '下一章') {
          return btn.href;
        }
      }

      // 尝试使用 CSS 选择器
      const nextPageSelectors = [
        'a.next',
        'a.next-page',
        'a[rel="next"]',
        '.pagination a:last-child',
        '#pages a:last-child'
      ];

      for (const selector of nextPageSelectors) {
        const el = document.querySelector(selector);
        if (el && el !== window) {
          return el.href;
        }
      }

      return null;
    },

    findNextPageUrlInDoc(doc) {
      // 在指定文档中查找下一页链接
      const nextButtons = doc.querySelectorAll('a');
      for (const btn of nextButtons) {
        const text = btn.textContent?.trim();
        if (text === '下一页' || text === '下页' || text === '下一章') {
          return btn.href;
        }
      }

      const nextPageSelectors = [
        'a.next',
        'a.next-page',
        'a[rel="next"]',
        '.pagination a:last-child',
        '#pages a:last-child'
      ];

      for (const selector of nextPageSelectors) {
        const el = doc.querySelector(selector);
        if (el && el !== window) {
          return el.href;
        }
      }

      return null;
    },

    // ========== 标题选择功能 ==========

    collectTitleOptions() {
      const options = [];
      const seen = new Set();

      // 0. 【优先】下载按钮所在的 h1 标题
      const downloadBtnH1 = document.querySelector('button#downloadMenuBtn')?.closest('h1');
      if (downloadBtnH1) {
        const text = downloadBtnH1.childNodes[0]?.textContent?.trim() || downloadBtnH1.innerText?.replace('下载', '').trim();
        if (text && !seen.has(text)) {
          options.push({ value: 'download_btn_h1', label: `📌 下载位置: ${text}`, text: text });
          seen.add(text);
        }
      }

      // 1. 页面标题
      const pageTitle = document.title?.trim();
      if (pageTitle && !seen.has(pageTitle)) {
        options.push({ value: 'page_title', label: `页面标题: ${pageTitle}`, text: pageTitle });
        seen.add(pageTitle);
      }

      // 2. h1 标签
      const h1Elements = document.querySelectorAll('h1');
      h1Elements.forEach((h1, idx) => {
        const text = h1.innerText?.trim();
        if (text && !seen.has(text)) {
          options.push({ value: `h1_${idx}`, label: `H1标题: ${text}`, text: text });
          seen.add(text);
        }
      });

      // 3. 站点配置的 title 选择器
      if (state.currentSiteSelector && state.currentSiteSelector.title) {
        const titleElement = document.querySelector(state.currentSiteSelector.title);
        if (titleElement) {
          const text = titleElement.innerText?.trim();
          if (text && !seen.has(text)) {
            options.push({ value: 'site_selector', label: `站点配置: ${text}`, text: text });
            seen.add(text);
          }
        }
      }

      // 4. meta title
      const metaTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
      if (metaTitle && !seen.has(metaTitle)) {
        options.push({ value: 'meta_title', label: `Meta标题: ${metaTitle}`, text: metaTitle });
        seen.add(metaTitle);
      }

      return options;
    },

    updateTitleSelect() {
      const options = this.collectTitleOptions();

      // 清空现有选项
      elements.titleSelect.innerHTML = '<option value="">自动检测（推荐）</option>';

      // 添加新选项
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.text;
        option.textContent = opt.label;
        elements.titleSelect.appendChild(option);
      });
    },

    // ========== 清洗规则管理弹窗 ==========

    showCleanRuleModal() {
      if (!elements.cleanRuleModal) this.init();
      this.renderCleanRulesList();
      elements.cleanRuleModal.style.display = 'flex';
    },

    closeCleanRuleModal() {
      if (elements.cleanRuleModal) {
        elements.cleanRuleModal.style.display = 'none';
      }
    },

    renderCleanRulesList() {
      const allRules = CleanRuleManager.getAllRules();
      const html = allRules.map(rule => `
      <div style="margin-bottom:12px; padding:12px; background:#f9f9f9; border-radius:8px; ${rule.builtin ? '' : 'border-left:3px solid #66bb6a;'}">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <input type="checkbox" class="bqg-rule-enabled" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''} style="cursor:pointer;">
              <span style="font-weight:600; color:#333;">${rule.name}</span>
              ${rule.builtin ? '<span style="font-size:10px; color:#999;">[内置]</span>' : '<span style="font-size:10px; color:#66bb6a;">[自定义]</span>'}
            </div>
            <div style="font-size:11px; color:#666; font-family:monospace; background:#f0f0f0; padding:4px 6px; border-radius:4px; margin-bottom:4px;">/${rule.pattern}/${rule.flags}</div>
            <div style="font-size:11px; color:#999;">${rule.description || '无描述'}</div>
          </div>
          ${!rule.builtin ? `<button data-rule-id="${rule.id}" class="bqg-delete-clean-rule-btn" style="background:#f44336; color:white; padding:6px 12px; border-radius:4px; font-size:11px; cursor:pointer; border:none;">删除</button>` : ''}
        </div>
      </div>
    `).join('');

      elements.cleanRulesList.innerHTML = html || '<div style="text-align:center; color:#999; padding:20px;">暂无规则</div>';

      // 绑定复选框事件
      elements.cleanRulesList.querySelectorAll('.bqg-rule-enabled').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const ruleId = parseInt(e.target.dataset.id);
          CleanRuleManager.toggleRule(ruleId);
        });
      });

      // 绑定删除按钮事件
      elements.cleanRulesList.querySelectorAll('.bqg-delete-clean-rule-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ruleId = parseInt(e.target.dataset.ruleId);
          if (confirm('确定删除此规则？')) {
            CleanRuleManager.deleteRule(ruleId);
            this.renderCleanRulesList();
            showToast('✅ 删除成功', 'success');
          }
        });
      });
    },

    addCleanRule() {
      const name = prompt('规则名称:');
      if (!name) return;

      const pattern = prompt('正则表达式:');
      if (!pattern) return;

      const flags = prompt('标志位 (如: g, i, gi):') || 'g';
      const description = prompt('描述（可选）:') || '';

      try {
        // 测试正则表达式是否有效
        new RegExp(pattern, flags);
      } catch (e) {
        showToast('正则表达式无效: ' + e.message, 'error');
        return;
      }

      if (CleanRuleManager.addRule({ name, pattern, flags, description })) {
        this.renderCleanRulesList();
        showToast('✅ 添加成功', 'success');
      } else {
        showToast('添加失败', 'error');
      }
    },

    importCleanRules() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          if (CleanRuleManager.importRules(event.target.result)) {
            this.renderCleanRulesList();
            showToast('✅ 导入成功', 'success');
          } else {
            showToast('导入失败，请检查文件格式', 'error');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    },

    resetCleanRules() {
      if (confirm('确定重置所有清洗规则？自定义规则将丢失！')) {
        CleanRuleManager.resetToDefault();
        this.renderCleanRulesList();
        showToast('✅ 已重置为默认规则', 'success');
      }
    },

    // ========== 缓存清除功能 ==========

    clearCacheByType(type) {
      const CACHE_TYPES = {
        progress: {
          name: '下载进度',
          pattern: /^bqg_progress_/,
          description: '清除所有下载进度缓存（断点续传数据）'
        },
        config: {
          name: '配置设置',
          keys: ['bqg_concurrency', 'bqg_maxRetries', 'bqg_timeout', 'bqg_minContentLength',
                 'bqg_throttleMin', 'bqg_throttleMax', 'bqg_enablePreview', 'bqg_previewCount',
                 'bqg_enableDetection', 'bqg_duplicateThreshold',
                 'bqg_adThreshold', 'bqg_disableResume'],
          description: '清除配置设置（将恢复默认值）',
          needReload: true
        },
        rules: {
          name: '清洗规则',
          pattern: /^bqg_(clean_rules|custom_rules|disabled_builtin_rules)$/,
          description: '清除自定义清洗规则和规则启用状态'
        },
        sites: {
          name: '站点规则',
          pattern: /^bqg_site_rules$/,
          description: '清除自定义站点规则'
        },
        all: {
          name: '所有缓存',
          pattern: /^bqg_/,
          description: '清除所有缓存数据（包括进度、配置、规则等）',
          needReload: true
        }
      };

      const cacheType = CACHE_TYPES[type];
      if (!cacheType) {
        showToast('❌ 未知的缓存类型', 'error');
        return;
      }

      const keysToRemove = [];

      if (cacheType.keys) {
        cacheType.keys.forEach(key => {
          if (localStorage.getItem(key)) {
            keysToRemove.push(key);
          }
        });
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && cacheType.pattern.test(key)) {
            keysToRemove.push(key);
          }
        }
      }

      if (keysToRemove.length === 0) {
        showToast(`没有${cacheType.name}需要清除`, 'info');
        return;
      }

      if (!confirm(`确定要清除${cacheType.name}吗？\n\n${cacheType.description}\n\n将清除 ${keysToRemove.length} 项数据\n\n此操作不可撤销！`)) {
        return;
      }

      try {
        keysToRemove.forEach(key => localStorage.removeItem(key));
        showToast(`✅ ${cacheType.name}已清除，共 ${keysToRemove.length} 项`, 'success');

        if (cacheType.needReload) {
          setTimeout(() => location.reload(), 1000);
        }
      } catch (e) {
        showToast(`清除失败：${e.message}`, 'error');
      }
    },

    // ========== 规则分析器弹窗 ==========

    showAnalyzerModal(results) {
      if (!elements.analyzerModal) this.init();

      let html = '';
      if (results.detected) {
        html += '<div style="margin-bottom:15px; padding:12px; background:#c8e6c9; border-radius:8px;">';
        html += '<div style="font-weight:bold; color:#2e7d32; margin-bottom:8px;">✅ 检测成功</div>';
        html += `<div><strong>目录容器:</strong> <code>${results.detected.toc || '未检测到'}</code></div>`;
        html += `<div><strong>章节选择器:</strong> <code>${results.detected.chapters || '未检测到'}</code></div>`;
        html += `<div><strong>标题选择器:</strong> <code>${results.detected.title || '未检测到'}</code></div>`;
        html += '</div>';
      }

      if (results.suggestions && results.suggestions.length > 0) {
        html += '<div style="margin-top:15px;"><strong>建议:</strong><ul style="margin:5px 0; padding-left:20px;">';
        results.suggestions.forEach(s => {
          html += `<li>${s}</li>`;
        });
        html += '</ul></div>';
      }

      elements.analyzerContent.innerHTML = html;
      elements.analyzerModal.style.display = 'flex';

      // 保存分析结果供应用
      state.lastAnalyzerResults = results;
    },

    closeAnalyzerModal() {
      if (elements.analyzerModal) {
        elements.analyzerModal.style.display = 'none';
      }
    },

    applyAnalyzedRule() {
      if (!state.lastAnalyzerResults || !state.lastAnalyzerResults.detected) {
        showToast('没有可应用的规则', 'warn');
        return;
      }

      const detected = state.lastAnalyzerResults.detected;
      const rule = {
        name: window.location.hostname,
        hostname: window.location.hostname,
        toc: detected.toc || '',
        chapters: detected.chapters || '',
        content: ['div#content', '#chaptercontent', '.content'],
        title: detected.title || 'h1',
        bookInfo: '',
        custom: true
      };

      if (SiteRuleManager.addRule(rule)) {
        state.currentSiteSelector = rule;
        this.closeAnalyzerModal();
        showToast('✅ 规则已应用并生效', 'success');
      } else {
        showToast('应用规则失败', 'error');
      }
    },

    exportAnalyzedRule() {
      if (!state.lastAnalyzerResults || !state.lastAnalyzerResults.detected) {
        showToast('没有可导出的规则', 'warn');
        return;
      }

      const detected = state.lastAnalyzerResults.detected;
      const rule = {
        name: window.location.hostname,
        hostname: window.location.hostname,
        toc: detected.toc || '',
        chapters: detected.chapters || '',
        content: ['div#content', '#chaptercontent', '.content'],
        title: detected.title || 'h1',
        bookInfo: ''
      };

      const dataStr = JSON.stringify([rule], null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${window.location.hostname}-rule.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('✅ 规则已导出', 'success');
    },

    close(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }
  };

  // 笔趣阁下载器 - 入口文件
  // 功能：模块组装、初始化


  // ========== 全局暴露（油猴脚本兼容性）==========
  (function() {

    // 初始化
    function init() {
      console.log('🚀 笔趣阁下载器 v0.9.14 已加载');

      // 导出全局变量（供调试使用）
      window.BQG = {
        CONFIG,
        CONSTANTS,
        SITE_SELECTORS,
        RuleAnalyzer,
        CleanRuleManager,
        SiteRuleManager,
        ElementPicker,
        ContentDetector,
        gmFetch,
        cleanContent,
        detectSiteStructure,
        adjustConcurrency
      };

      // 注册菜单命令
      if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('小说下载工具', () => {
          ModalManager.showDownloadModal();
        });
        GM_registerMenuCommand('⚙️ 下载设置', () => {
          ModalManager.showConfigModal();
        });
        GM_registerMenuCommand('📖 下载当前章节', () => {
          DownloadOrchestrator.downloadCurrentChapter();
        });
      }

      // 添加下载按钮
      addDownloadButton();
    }

    // 添加下载按钮到目录页
    function addDownloadButton() {
      // 排除掉页头、导航等区域的 h1，查找目录页真正的标题
      const h1Candidates = Array.from(document.querySelectorAll("h1"));

      // 过滤掉明显不是小说标题的 h1
      let targetH1 = h1Candidates.find(h1 => {
        const className = h1.className || '';
        const parentId = h1.parentElement?.id || '';
        const parentClass = h1.parentElement?.className || '';

        // 排除：logo、header、nav、footer 等区域的 h1
        const excludePatterns = [
          /logo/i, /header/i, /nav/i, /footer/i,
          /banner/i, /topbar/i, /navbar/i
        ];

        // 检查 h1 本身或其父元素是否匹配排除模式
        if (excludePatterns.some(p => p.test(className) || p.test(parentId) || p.test(parentClass))) {
          return false;
        }

        // 优先选择在主要内容区域的 h1
        // 通常目录页的标题会在 #main、.main、#content、.content 等容器内
        const mainContainers = ['main', 'content', 'bookinfo', 'book-info', 'detail', 'novel-info'];
        let inMainArea = false;
        let parent = h1.parentElement;
        while (parent && parent !== document.body) {
          if (mainContainers.some(c => parent.id?.toLowerCase().includes(c) || parent.className?.toLowerCase().includes(c))) {
            inMainArea = true;
            break;
          }
          parent = parent.parentElement;
        }

        return inMainArea || true; // 如果找不到主区域，返回第一个非排除的 h1
      });

      // 如果没找到合适的 h1，使用第一个 h1 但排除 logo 类
      if (!targetH1) {
        targetH1 = h1Candidates.find(h1 => !h1.className?.includes('logo'));
      }

      if (!targetH1) return false;

      if (document.querySelector('button#downloadMenuBtn')) return true;

      const btn = document.createElement("button");
      btn.innerText = "下载";
      btn.id = "downloadMenuBtn";
      btn.style.cssText = "padding:4px 12px; margin:0 0 0 10px; font-size:14px; font-weight:500; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; border:none; border-radius:6px; cursor:pointer; vertical-align:middle;";
      btn.addEventListener('click', () => ModalManager.showDownloadModal());

      // 尝试在 h1 的文本内容之后插入按钮
      // 查找 h1 中的文本节点
      let textNode = null;
      for (let i = 0; i < targetH1.childNodes.length; i++) {
        if (targetH1.childNodes[i].nodeType === Node.TEXT_NODE && targetH1.childNodes[i].textContent.trim()) {
          textNode = targetH1.childNodes[i];
          break;
        }
      }

      if (textNode) {
        // 在文本节点后插入按钮
        if (textNode.nextSibling) {
          targetH1.insertBefore(btn, textNode.nextSibling);
        } else {
          targetH1.appendChild(btn);
        }
      } else {
        // 没有找到文本节点，直接追加到末尾
        targetH1.appendChild(btn);
      }

      return true;
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
    } else {
      setTimeout(init, 100);
    }

  })();

})();

// 生成时间: 2026/2/28 14:54:01
//# sourceMappingURL=笔趣阁下载器.user.js.map
