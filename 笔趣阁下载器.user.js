// ==UserScript==
// @name         笔趣阁下载器
// @namespace    http://tampermonkey.net/
// @version      0.9.11
// @description  可在笔趣阁下载小说（TXT格式）。支持断点续传、取消下载、速度显示、失败重试、一键重试失败章节、可配置参数（含智能限流上下限）、智能限流、内容清洗、进度条语义化、老浏览器兼容、现代化UI设计、章节预览、内容质量检测（重复/广告/异常）、实时速度图表、站点规则管理（自定义站点支持）、智能规则分析（自动提取站点选择器）、手动元素标记（AdGuard风格）、章节列表分页支持（自动检测并加载所有分页）、GM_xmlhttpRequest 绕过 CORS 限制。在小说目录页面使用。（仅供交流，可能存在bug）（已测试网址:beqege.cc|bigee.cc|bqgui.cc|bbiquge.la|3bqg.cc|xbiqugew.com|bqg862.xyz|bqg283.cc|snapd.net|alicesw.com|3haitang.com|shibashiwu.net|hbdafeng.com）
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

(function() {

  // 配置管理
  const CONFIG = {
    concurrency: parseInt(localStorage.getItem('bqg_concurrency') || '8'),
    maxRetries: parseInt(localStorage.getItem('bqg_maxRetries') || '3'),
    timeout: parseInt(localStorage.getItem('bqg_timeout') || '10'),
    minContentLength: parseInt(localStorage.getItem('bqg_minContentLength') || '50'),
    throttleMin: parseInt(localStorage.getItem('bqg_throttleMin') || '3'),
    throttleMax: parseInt(localStorage.getItem('bqg_throttleMax') || '15'),
    // 新增功能配置
    enablePreview: localStorage.getItem('bqg_enablePreview') !== 'false',
    previewCount: parseInt(localStorage.getItem('bqg_previewCount') || '3'),
    enableDetection: localStorage.getItem('bqg_enableDetection') !== 'false',
    duplicateThreshold: parseFloat(localStorage.getItem('bq_duplicateThreshold') || '0.85'),
    adThreshold: parseInt(localStorage.getItem('bqg_adThreshold') || '20'),
    disableResume: localStorage.getItem('bqg_disableResume') === 'true',
    // 分页配置
    maxTocPages: parseInt(localStorage.getItem('bqg_maxTocPages') || '10'),
    maxTocPagesHardLimit: 50,
    maxTotalChapters: 5000,
    paginationRetry: parseInt(localStorage.getItem('bqg_paginationRetry') || '3'),
    paginationTimeout: parseInt(localStorage.getItem('bqg_paginationTimeout') || '10000')
  };

  // 显示当前配置状态
  console.log('⚙️ [配置加载]');
  console.log(`   并发数: ${CONFIG.concurrency}`);
  console.log(`   断点续传: ${CONFIG.disableResume ? '禁用' : '启用'}`);
  console.log(`   智能限流: ${CONFIG.throttleMin} ~ ${CONFIG.throttleMax}`);
  console.log(`   内容检测: ${CONFIG.enableDetection ? '启用' : '禁用'}`);
  console.log(`   分页支持: 最大${CONFIG.maxTocPages}页（上限${CONFIG.maxTocPagesHardLimit}页）`);

  // 显示现有缓存
  const existingCaches = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('bqg_')) {
      existingCaches.push(key);
    }
  }
  if (existingCaches.length > 0) {
    console.log('💾 [现有缓存]');
    existingCaches.forEach(key => {
      console.log(`   • ${key}`);
    });
    console.log(`   共 ${existingCaches.length} 项缓存数据`);
    console.log('   提示: 如需清除缓存，请在设置中点击相应按钮');
  } else {
    console.log('💾 [现有缓存] 无');
  }

  // 常量定义（消除魔法数字）
  const CONSTANTS = {
    IFRAME_CHECK_INTERVAL: 200,        // iframe内容检测间隔（毫秒）
    RETRY_BASE_DELAY: 1000,            // 重试基础延迟（毫秒）
    PROGRESS_SAVE_THROTTLE: 1000,      // 进度保存节流间隔（毫秒）
    PROGRESS_SAMPLE_SIZE: 10,          // 智能限流样本数量
    PROGRESS_SAMPLE_MAX: 20,           // 最大保留样本数
    CONCURRENCY_MIN: 3,                // 最小并发数
    CONCURRENCY_MAX: 15,               // 最大并发数
    SLOW_RESPONSE_THRESHOLD: 3000,     // 慢响应阈值（毫秒）
    FAST_RESPONSE_THRESHOLD: 1000,     // 快响应阈值（毫秒）
  };

  // 站点选择器策略配置（数据驱动）
  const SITE_SELECTORS = [
    {
      name: 'beqege/bigee/bqgui',
      hostname: 'beqege.cc', // 添加 hostname 字段（使用主域名）
      toc: '#list',
      chapters: 'dl dd > a[href]',
      chaptersAlt: 'dl center.clear ~ dd > a[href]',
      content: ['div#content', '#chaptercontent', '.content'],
      title: '#maininfo #info h1',
      bookInfo: '#maininfo #info'
    },
    {
      name: 'listmain',
      hostname: 'bqgui.cc', // 添加 hostname 字段
      toc: '.listmain',
      chapters: 'dl dd > a[href]',
      content: ['#chaptercontent', 'div#content', '.content'],
      title: '.info h1',
      bookInfo: 'div.book div.info'
    },
    {
      name: 'list-chapter',
      hostname: 'bqgui.cc', // 添加 hostname 字段
      toc: '.list-chapter',
      chapters: 'div.booklist > ul > li > a[href]',
      content: ['.content', 'div#content', '#chaptercontent'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'biquge.net',
      hostname: 'biquge.net', // 添加 hostname 字段
      toc: 'div.section-box',
      chapters: 'div.section-box ul.section-list li > a[href]',
      content: ['div.reader-main', 'div#content', '#chaptercontent', '.content', '#htmlContent'],
      title: 'h1',
      bookInfo: '#info, .book-info, .small'
    },
    {
      name: 'snapd.net',
      hostname: 'snapd.net', // 添加 hostname 字段
      toc: 'dl',
      tocPattern: '最新章节列表',
      chapters: 'dl > dd > a[href*="/read/"]',
      content: ['#chaptercontent', 'div#content', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'alicesw.com',
      hostname: 'alicesw.com', // 添加 hostname 字段
      toc: 'ul.mulu_list',
      chapters: 'ul.mulu_list > li > a[href]',
      content: ['.read-content', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: '3haitang.com',
      hostname: '3haitang.com', // 添加 hostname 字段
      toc: 'ul',
      tocPattern: '最新章节列表',
      chapters: 'ul > li > a[href]',
      content: ['#content', '#htmlContent', 'div#content', '#chaptercontent', '.content'],
      title: 'h1',
      bookInfo: 'h1'
    },
    {
      name: 'shibashiwu.net',
      hostname: 'shibashiwu.net', // 添加 hostname 字段
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

  // GM_xmlhttpRequest Promise 封装（绕过 CORS 限制）
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        // 使用 Tampermonkey 的 GM_xmlhttpRequest API
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          onload: (response) => {
            // 解析 responseHeaders 字符串为对象
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
              text: () => Promise.resolve(response.responseText),
              // 简化 headers 为普通对象（不需要完整的 Headers API）
              headers: headersObj,
              // 添加原始 headers 字符串（供调试使用）
              _rawHeaders: response.responseHeaders
            });
          },
          onerror: () => {
            reject(new Error('GM_xmlhttpRequest 请求失败'));
          },
          ontimeout: () => {
            reject(new Error('GM_xmlhttpRequest 请求超时'));
          }
        });
      } else {
        // 降级到普通 fetch（如果没有 GM_xmlhttpRequest）
        fetch(url).then(resolve).catch(reject);
      }
    });
  }

  // 智能规则分析器
  const RuleAnalyzer = {
    analyzedRule: null, // 保存分析结果
    currentType: '', // 'toc' 或 'content'
    
    // 检测内容中的清洗pattern（智能识别域名等垃圾内容）
    detectCleanPatterns(contentEl) {
      if (!contentEl) return [];
      
      const content = contentEl.innerText;
      const detectedPatterns = [];
      
      // 常见顶级域名后缀
      const TLDS = ['com','net','org','cn','cc','io','la','xyz','tv','me','info','biz','top','vip','pro','tw','hk','uk','us','jp','co'];
      const tldPattern = TLDS.join('|');
      
      // 检测模式1: TLD锚定域名（核心改进 - 任意分隔符均可识别）
      // 匹配: bquge.com / bq93 ⊙cc / bqjd⊕cc / xquge· cc 等所有变体
      const domainRegex = new RegExp(`[a-z0-9]{2,}[^a-z\\u4e00-\\u9fa5\\r\\n]+(?:${tldPattern})\\b`, 'gi');
      const matches = content.match(domainRegex);
      
      if (matches && matches.length >= 2) {
        // 统计出现频率（去除空格再比较）
        const freqMap = {};
        matches.forEach(m => {
          const normalized = m.toLowerCase().replace(/\s+/g, '');
          freqMap[normalized] = (freqMap[normalized] || 0) + 1;
        });
        
        const repeatedPatterns = Object.entries(freqMap).filter(([k, v]) => v >= 2);
        
        if (repeatedPatterns.length > 0 || matches.length >= 3) {
          // 提取分隔符集合（用于展示，实际正则使用宽松模式）
          const separators = new Set();
          matches.forEach(m => {
            const sep = m.match(/[^a-z0-9]+/gi);
            if (sep) sep[0].split('').forEach(c => separators.add(c));
          });
          
          detectedPatterns.push({
            type: 'domain_like',
            pattern: `[a-z0-9]{2,}[^a-z\\\\u4e00-\\\\u9fa5\\\\r\\\\n]+(?:${tldPattern})\\b`,
            description: `检测到疑似域名（分隔符: "${Array.from(separators).map(s => s === ' ' ? '空格' : s).join('')}"，出现${matches.length}次）`,
            confidence: matches.length >= 5 ? 'high' : 'medium',
            sample: matches.slice(0, 3).join(', ')
          });
        }
      }
      
      // 检测模式2: 重复的英文短字符串（如 "biquge biquge biquge"）
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
      
      // 检测模式3: 重复的中文短语（如 "笔趣阁 笔趣阁 笔趣阁"）
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
        /本站推荐/g,
        /请记住本站域名/g,
        /最快更新/g,
        /一秒记住/g
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
      
      // 检测模式6: 高密度的非正常内容（短字符串重复出现超过5次）
      const words = content.toLowerCase().match(/\b[a-z]{4,8}\b/g);
      if (words && words.length > 10) {
        const wordFreq = {};
        words.forEach(w => wordFreq[w] = (wordFreq[w] || 0) + 1);
        const highFreqWords = Object.entries(wordFreq).filter(([k, v]) => v >= 5);
        
        if (highFreqWords.length > 0) {
          const suspiciousWords = highFreqWords.filter(([word, count]) => 
            // 排除常见词
            !['that', 'this', 'with', 'from', 'have', 'been', 'said', 'will', 'what'].includes(word)
          );
          
          if (suspiciousWords.length > 0) {
            detectedPatterns.push({
              type: 'high_frequency',
              pattern: suspiciousWords.map(([w, c]) => `\\b${w}\\b`).join('|'),
              description: `检测到高频重复词汇（${suspiciousWords.map(([w, c]) => `"${w}"×${c}`).join(', ')}）`,
              confidence: 'medium',
              sample: suspiciousWords.slice(0, 2).map(([w, c]) => `${w} (${c}次)`).join(', ')
            });
          }
        }
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
      result.name = document.title.split('-')[document.title.split('-').length - 1].trim() || window.location.hostname;
      
      // 2. 分析目录容器（寻找包含大量链接的容器）
      const containers = ['#list', '.listmain', '.list-chapter', '#chapterlist', '.book-list', '.chapter-list', 'dl'];
      for (const selector of containers) {
        const el = document.querySelector(selector);
        if (el && el.querySelectorAll('a[href]').length > 10) {
          result.toc = selector;
          result.confidence.toc = 'high';
          break;
        }
      }
      
      // 如果没找到，尝试通用方法：找链接最多的容器
      if (!result.toc) {
        const allContainers = document.querySelectorAll('div, dl, section, article');
        let maxLinks = 0;
        let bestContainer = null;
        allContainers.forEach(container => {
          const links = container.querySelectorAll('a[href]');
          if (links.length > maxLinks && links.length > 10) {
            maxLinks = links.length;
            bestContainer = container;
          }
        });
        if (bestContainer) {
          // 尝试生成选择器
          if (bestContainer.id) result.toc = `#${bestContainer.id}`;
          else if (bestContainer.className) result.toc = `.${bestContainer.className.split(' ')[0]}`;
          else result.toc = bestContainer.tagName.toLowerCase();
          result.confidence.toc = 'medium';
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

      // 1. 尝试常见的下一页选择器
      const commonSelectors = [
        'a.next-page',
        'a.next',
        'a[rel="next"]',
        '.pagination a.next',
        '.pager a.next',
        'li.next a',
        'li.next-page a',
        '#next-page',
        'a:has-text("下一页")',
        'a:has-text("下页")',
        'a:has-text("Next")',
        'a:has-text("»")'
      ];

      // 2. 先尝试配置的选择器
      for (const selector of commonSelectors) {
        try {
          // 注意：a:has-text() 语法需要特殊处理
          if (selector.includes(':has-text(')) {
            const text = selector.match(/"([^"]+)"/)[1];
            const links = document.querySelectorAll('a');
            for (const link of links) {
              if (link.innerText.trim() === text) {
                result.nextPageSelector = `a:has-text("${text}")`;
                result.hasNextPage = true;
                result.confidence = 'high';
                result.nextPagePattern = text;
                break;
              }
            }
            if (result.hasNextPage) break;
          } else {
            const el = document.querySelector(selector);
            if (el) {
              result.nextPageSelector = selector;
              result.hasNextPage = true;
              result.confidence = 'high';
              break;
            }
          }
        } catch (e) {
          // 忽略选择器错误
        }
      }

      // 3. 检测分页容器（页码列表）
      const paginationContainers = document.querySelectorAll('.pagination, .page, .pager, .page-list, .pagelist');
      if (paginationContainers.length > 0) {
        for (const container of paginationContainers) {
          const links = container.querySelectorAll('a');
          if (links.length >= 2) {
            // 检查是否有明确的下一页或页码模式
            const hasPageNumbers = Array.from(links).some(l => l.innerText.match(/^\d+$/));
            if (hasPageNumbers) {
              result.paginationContainer = container.className ? `.${container.className.split(' ')[0]}` : 'pagination';
              result.confidence = 'medium';
              break;
            }
          }
        }
      }

      // 4. 尝试通过文本匹配查找下一页
      if (!result.hasNextPage) {
        const allLinks = document.querySelectorAll('a');
        const nextPagePatterns = ['下一页', '下页', '下1页', 'next', 'next page', '»'];
        for (const link of allLinks) {
          const text = link.innerText.trim().toLowerCase();
          if (nextPagePatterns.some(pattern => text.includes(pattern.toLowerCase()))) {
            result.nextPagePattern = link.innerText.trim();
            result.hasNextPage = true;
            result.confidence = 'medium';
            break;
          }
        }
      }

      // 5. 尝试通过URL模式检测（如 page=2, p/2 等）
      if (!result.hasNextPage) {
        const currentUrl = window.location.href;
        const urlMatch = currentUrl.match(/(page|p|pageindex)[-_]?(\d+)|\/(\d+)\.html/i);
        if (urlMatch) {
          // 检测到页码模式，尝试查找下一页链接
          const currentPage = parseInt(urlMatch[2] || urlMatch[3]);
          if (currentPage) {
            const nextPageUrl = currentUrl.replace(/(page|p|pageindex)[-_]?(\d+)|\/(\d+)\.html/i,
              () => {
                // 根据匹配类型生成下一页URL
                if (urlMatch[1]) return `${urlMatch[1]}${currentPage + 1}`;
                return `/${currentPage + 1}.html`;
              });
            // 检查是否存在这个URL的链接
            const allLinks = document.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.href === nextPageUrl) {
                result.nextPagePattern = 'URL模式检测';
                result.hasNextPage = true;
                result.confidence = 'low';
                break;
              }
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
        name: document.title.split('-')[document.title.split('-').length - 1].trim() || window.location.hostname,
        content: [],
        nextPage: '',
        confidence: {}
      };
      
      // 1. 分析内容选择器（常见模式）
      const contentSelectors = [
        'div#content',
        '#chaptercontent', 
        '.content',
        '#BookText',
        '.chapter-content',
        'article',
        '.text-content',
        '.book-content'
      ];
      
      contentSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 100) {
          result.content.push(selector);
        }
      });
      
      if (result.content.length === 0) {
        // 降级：找文本最多的div
        const divs = document.querySelectorAll('div');
        let maxText = 0;
        let bestDiv = null;
        divs.forEach(div => {
          const text = div.innerText.length;
          if (text > maxText && text > 500) {
            maxText = text;
            bestDiv = div;
          }
        });
        if (bestDiv) {
          if (bestDiv.id) result.content.push(`#${bestDiv.id}`);
          else if (bestDiv.className) result.content.push(`.${bestDiv.className.split(' ')[0]}`);
          result.confidence.content = 'low';
        }
      } else {
        result.confidence.content = 'high';
      }
      
      // 2. 分析"下一页"链接
      const nextPageSelectors = [
        '.read-page a[rel="next"]',
        'a[rel="next"]',
        '.page a:contains("下一页")',
        '.bottem a:contains("下一页")',
        'a.next',
        '.nextPage',
        'a[href*="next"]'
      ];
      
      for (const selector of nextPageSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            result.nextPage = selector;
            result.confidence.nextPage = 'high';
            break;
          }
        } catch (e) {
          // 跳过不支持的选择器（如:contains）
        }
      }
      
      // 通用方法：查找包含"下一页"文本的链接
      if (!result.nextPage) {
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          if (link.innerText.includes('下一页') || link.innerText === '下页' || link.innerText.toLowerCase() === 'next') {
            // 尝试生成选择器
            if (link.className) {
              result.nextPage = `a.${link.className.split(' ')[0]}`;
            } else {
              result.nextPage = 'a'; // 降级方案
            }
            result.confidence.nextPage = 'medium';
            break;
          }
        }
      }
      
      // 3. 智能检测内容清洗规则
      const contentEl = result.content.length > 0 ? document.querySelector(result.content[0]) : null;
      result.cleanPatterns = this.detectCleanPatterns(contentEl);
      result.confidence.cleanPatterns = result.cleanPatterns.length > 0 ? 'high' : 'low';
      
      this.analyzedRule = result;
      this.currentType = 'content';
      return result;
    },
    
    // 生成HTML报告（根据类型）
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
        // 章节目录规则报告
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
          
          <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:600; color:#333;">书籍信息</span>
              <span style="padding:2px 8px; background:#9e9e9e; color:white; border-radius:12px; font-size:11px;">可选</span>
            </div>
            <input id="analyzedBookInfo" type="text" value="${rule.bookInfo}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
          </div>
          
          <div style="padding:12px; background:#fff3cd; border-radius:8px; font-size:12px; color:#856404;">
            <strong>💡 提示：</strong>此规则用于目录页面，提取章节列表。请确认选择器准确后应用。
          </div>
        `;
      } else {
        // 内容页规则报告
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
          
          <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:600; color:#333;">下一页选择器</span>
              <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.nextPage || 'low')}; color:white; border-radius:12px; font-size:11px;">可信度: ${confidenceText(rule.confidence.nextPage || 'low')}</span>
            </div>
            <input id="analyzedNextPage" type="text" value="${rule.nextPage}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:monospace;">
            <div style="font-size:11px; color:#999; margin-top:4px;">用于支持分页章节的自动翻页</div>
          </div>
          
          <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:600; color:#333;">内容清洗规则（正则表达式，多个用 | 分隔）</span>
              <span style="padding:2px 8px; background:${confidenceColor(rule.confidence.cleanPatterns || 'low')}; color:white; border-radius:12px; font-size:11px;">检测: ${rule.cleanPatterns?.length || 0}个</span>
            </div>
            <textarea id="analyzedCleanPatterns" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:12px; font-family:monospace; min-height:80px;" placeholder="暂未检测到需要清洗的内容">${rule.cleanPatterns?.map(p => p.pattern).join(' | ') || ''}</textarea>
            ${rule.cleanPatterns && rule.cleanPatterns.length > 0 ? `
            <div style="margin-top:8px; padding:8px; background:#e8f5e9; border-radius:6px; font-size:11px;">
              <div style="font-weight:600; color:#2e7d32; margin-bottom:4px;">🔍 检测到的垃圾内容：</div>
              ${rule.cleanPatterns.map(p => `
                <div style="margin:4px 0; padding:4px; background:white; border-radius:4px;">
                  <div style="color:#666;"><strong>${p.description}</strong> (可信度: ${confidenceText(p.confidence)})</div>
                  <div style="color:#999; margin-top:2px;">示例: ${p.sample}</div>
                </div>
              `).join('')}
            </div>` : ''}
            <div style="font-size:11px; color:#999; margin-top:4px;">自动检测内容中的域名、URL、推广文案等垃圾内容，可手动编辑正则表达式</div>
          </div>
          
          <div style="padding:12px; background:#fff3cd; border-radius:8px; font-size:12px; color:#856404;">
            <strong>💡 提示：</strong>此规则用于内容页面，提取章节正文和处理翻页。内容清洗规则会自动过滤垃圾内容。
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
          bookInfo: document.getElementById('analyzedBookInfo').value
        };
      } else {
        // content type
        const cleanPatternsText = document.getElementById('analyzedCleanPatterns') ? document.getElementById('analyzedCleanPatterns').value.trim() : '';
        return {
          name: document.getElementById('analyzedName').value,
          content: document.getElementById('analyzedContent').value.split(',').map(s => s.trim()).filter(s => s),
          nextPage: document.getElementById('analyzedNextPage') ? document.getElementById('analyzedNextPage').value : '',
          cleanPatterns: cleanPatternsText ? cleanPatternsText.split('|').map(s => s.trim()).filter(s => s) : []
        };
      }
    }
  };

  // 内容清洗规则管理系统
  const CleanRuleManager = {
    // 获取默认清洗规则
    getDefaultRules() {
      // 常见顶级域名后缀（用于 TLD 锚定匹配）
      const TLDS = 'com|net|org|cn|cc|io|la|xyz|tv|me|info|biz|top|vip|pro|tw|hk|uk|us|jp|co';
      return [
        { id: 1, name: '站点推广文案', pattern: '(本站推荐|笔趣阁.*?最快更新|请记住本站域名|一秒记住.*?为您提供|最新网址|访问下载|『.*?』最新章节).*?[。！]', flags: 'g', enabled: true, builtin: true },
        { id: 2, name: '特殊标记和括号', pattern: '(【.*?提供.*?】|\\(.*?请搜索.*?\\))', flags: 'g', enabled: true, builtin: true },
        // 域名匹配策略：TLD锚定 + 宽松分隔符，覆盖任意符号（⊙⊕·○等）
        { id: 3, name: '域名和网址（TLD锚定，覆盖任意分隔符）', pattern: `(https?:\\/\\/[^\\s]+|www\\.[^\\s]+\\.\\w{2,4}|[a-z0-9]{2,}[^a-z\\u4e00-\\u9fa5\\r\\n]+(?:${TLDS})\\b)\\s?`, flags: 'gi', enabled: true, builtin: true },
        { id: 4, name: '分割线', pattern: '([-═]{3,}.*?[-═]{3,}|[-═]{3,})', flags: 'g', enabled: true, builtin: true },
        { id: 10, name: '导航箭头符号', pattern: '[\\s\\n]*[←→][\\s\\n]*', flags: 'g', enabled: true, builtin: true },
        { id: 8, name: '导航栏元素', pattern: '(上一章|下一章|下一页|目录|书签)(?=\\s|\\n|$)|热门推荐[：:].*?(?=\\n{2,}|$)|请记住本站.*?为您提供.*?(?=\\n|$)|本书源自.*?(?=\\n|$)', flags: 'gim', enabled: true, builtin: true },
        { id: 11, name: '连续导航栏组合（无分隔符）', pattern: '(上一章[\\s\\n]*目录[\\s\\n]*下一章[\\s\\n]*下一页|上一章[\\s\\n]*目录[\\s\\n]*下一页|目录[\\s\\n]*下一页|上一章[\\s\\n]*目录|热门推荐[：:][^\\n]{0,200}?[\\s\\n]*(兵王无敌|修仙暴徒|重新开始|转动的异能世界|一点风骨|荣耀与王座|欺天大世|这个首富|鬼志通鉴|最强魔神系统|近身武王))', flags: 'gim', enabled: true, builtin: true },
        { id: 9, name: '跨行导航栏组合', pattern: '(上一章[\\s\\n←]*[\\s\\n]*目录[\\s\\n→]*[\\s\\n]*下一章[\\s\\n]*书签[\\s\\n]*热门推荐)|(热门推荐[：:][^\\n]*(兵王无敌|修仙暴徒|重新开始|转动的异能世界|一点风骨|荣耀与王座|欺天大世|这个首富|鬼志通鉴|最强魔神系统|近身武王)[^\\n]*)', flags: 'gs', enabled: true, builtin: true },
        // 重复域名：同样用TLD锚定，连续出现2次以上
        { id: 5, name: '重复域名标识（TLD锚定）', pattern: `([a-z0-9]{2,}[^a-z\\u4e00-\\u9fa5\\r\\n]+(?:${TLDS})\\b\\s*){2,}`, flags: 'gi', enabled: true, builtin: true },
        { id: 6, name: '重复英文短字符串', pattern: '\\b([a-z]{3,10})\\s+\\1\\s+\\1\\b', flags: 'gi', enabled: true, builtin: true },
        { id: 7, name: '重复中文短语', pattern: '([\\u4e00-\\u9fa5]{2,4})\\s*\\1\\s*\\1', flags: 'g', enabled: true, builtin: true }
      ];
    },
    
    // 获取自定义规则
    getCustomRules() {
      const rules = localStorage.getItem('bqg_clean_rules');
      return rules ? JSON.parse(rules) : [];
    },
    
    // 保存自定义规则
    saveCustomRules(rules) {
      localStorage.setItem('bqg_clean_rules', JSON.stringify(rules));
    },
    
    // 获取所有规则（默认+自定义）
    getAllRules() {
      const defaultRules = this.getDefaultRules();
      const customRules = this.getCustomRules();
      return [...defaultRules, ...customRules];
    },
    
    // 获取启用的规则（转换为正则对象）
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
    
    // 添加规则
    addRule(rule) {
      const rules = this.getCustomRules();
      rules.push({ 
        ...rule, 
        id: Date.now(), 
        enabled: true, 
        builtin: false 
      });
      this.saveCustomRules(rules);
      return true;
    },
    
    // 更新规则
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
    
    // 删除规则（已修复：Number转换避免字符串/数字类型不匹配）
    deleteRule(id) {
      const numId = Number(id);
      const before = this.getCustomRules();
      const after = before.filter(r => Number(r.id) !== numId);
      if (after.length === before.length) return false;
      this.saveCustomRules(after);
      return true;
    },
    
    // 切换规则启用状态
    toggleRule(id, enabled) {
      const numId = Number(id);
      const customRules = this.getCustomRules();
      const customIndex = customRules.findIndex(r => Number(r.id) === numId);
      
      if (customIndex !== -1) {
        customRules[customIndex].enabled = enabled;
        this.saveCustomRules(customRules);
      } else {
        // 内置规则的启用状态单独存储（统一用数字存储）
        const numId = Number(id);
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
    
    // 检查内置规则是否被禁用
    isBuiltinRuleDisabled(id) {
      const disabledBuiltins = JSON.parse(localStorage.getItem('bqg_disabled_builtin_rules') || '[]').map(Number);
      return disabledBuiltins.includes(Number(id));
    },
    
    // 获取所有规则（含禁用状态）
    getAllRulesWithStatus() {
      const defaultRules = this.getDefaultRules().map(rule => ({
        ...rule,
        enabled: !this.isBuiltinRuleDisabled(rule.id)
      }));
      const customRules = this.getCustomRules();
      return [...defaultRules, ...customRules];
    },
    
    // 导出规则
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
    
    // 导入规则
    importRules(jsonStr) {
      try {
        const rules = JSON.parse(jsonStr);
        if (!Array.isArray(rules)) throw new Error('规则格式错误');
        
        // 验证规则格式
        for (const rule of rules) {
          if (!rule.name || !rule.pattern || !rule.flags) {
            throw new Error('规则缺少必需字段（name, pattern, flags）');
          }
          // 测试正则表达式是否有效
          new RegExp(rule.pattern, rule.flags);
        }
        
        // 合并到现有自定义规则
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
        alert(`导入失败: ${e.message}`);
        return false;
      }
    },
    
    // 重置为默认规则（只清除自定义规则和禁用状态）
    resetToDefault() {
      localStorage.removeItem('bqg_clean_rules');
      localStorage.removeItem('bqg_disabled_builtin_rules');
    }
  };

  // 站点规则管理系统
  const SiteRuleManager = {
    // 获取自定义规则
    getCustomRules() {
      const rules = localStorage.getItem('bqg_custom_rules');
      return rules ? JSON.parse(rules) : [];
    },
    
    // 保存自定义规则
    saveCustomRules(rules) {
      localStorage.setItem('bqg_custom_rules', JSON.stringify(rules));
    },
    
    // 获取所有规则（内置+自定义）
    getAllRules() {
      return [...SITE_SELECTORS, ...this.getCustomRules()];
    },
    
    // 添加规则
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
    
    // 删除规则
    deleteRule(id) {
      const numId = Number(id);
      const before = this.getCustomRules();
      const after = before.filter(r => Number(r.id) !== numId);
      if (after.length === before.length) return false;
      this.saveCustomRules(after);
      return true;
    },
    
    // 导出规则
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
    
    // 导入规则
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

  // ============================================================
  // 手动元素标记器（模拟 AdGuard 手动屏蔽逻辑）
  // 在无法识别的网页上允许用户点选 DOM 元素，打上语义标签后
  // 自动生成 CSS 选择器并写入 SiteRuleManager 持久化。
  // ============================================================
  const ElementPicker = {
    _mode: null,         // 'toc' | 'content'
    _picked: {},         // { toc, chapters, title, bookInfo, content, nextPage }
    _toolbar: null,      // 顶部浮动工具栏
    _menu: null,         // 气泡选择菜单
    _highlight: null,    // 当前悬停高亮元素
    _onComplete: null,   // 完成后的回调
    _onMouseMove: null,  // 事件监听器引用（用于清理）
    _onMouseClick: null,
    _dragging: false,    // 拖拽进行中标志

    // 各模式下可标记的类型定义
    _modeTypes: {
      toc: [
        { key: 'toc',      label: '📋 目录容器', desc: '包含所有章节链接的外层容器（必选）', required: true },
        { key: 'title',    label: '📌 书名',     desc: '显示书名的标题元素（必选）',         required: true },
        { key: 'bookInfo', label: 'ℹ️ 书籍信息', desc: '作者/简介等信息区域（可选）',        required: false }
      ],
      content: [
        { key: 'content',  label: '📖 章节正文', desc: '当前章节的正文内容区域（必选）', required: true },
        { key: 'nextPage', label: '⏭️ 下一页',   desc: '翻到下一页的链接按钮（可选）',   required: false }
      ]
    },

    // 进入标记模式
    start(mode, onComplete) {
      this._mode = mode;
      this._picked = {};
      this._onComplete = onComplete || null;
      this._createToolbar();
      this._bindEvents();
      document.documentElement.classList.add('bqg-picker-mode');
      showToast(
        `🎯 已进入手动标记模式（${mode === 'toc' ? '目录页' : '内容页'}）\n鼠标悬停选取元素，点击元素选择类型`,
        'info', 4000
      );
    },

    // 退出标记模式
    stop() {
      document.documentElement.classList.remove('bqg-picker-mode');
      this._removeMouseListeners();
      if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; }
      if (this._menu)    { this._menu.remove();    this._menu = null;    }
      // 清理 outsideClick 监听器
      if (this._outsideClickHandler) {
        document.removeEventListener('click', this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }
      this._clearHighlight();
      // 清除所有已标记元素的颜色
      document.querySelectorAll('.bqg-picker-marked').forEach(el => el.classList.remove('bqg-picker-marked'));
      this._mode = null;
    },

    // 生成最紧凑的 CSS 选择器
    // 优先级: #id > unique-class > parent > tag
    generateSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return 'body';

      // 1. #id（唯一）
      if (el.id) {
        const escaped = CSS.escape(el.id);
        if (document.querySelectorAll('#' + escaped).length === 1) return '#' + el.id;
      }

      // 2. 单个唯一 class
      if (el.classList && el.classList.length > 0) {
        for (const cls of el.classList) {
          const sel = '.' + CSS.escape(cls);
          if (document.querySelectorAll(sel).length === 1) return '.' + cls;
        }
        // 多 class 组合
        const combined = '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(combined).length === 1) {
          return '.' + Array.from(el.classList).join('.');
        }
      }

      // 3. parent > tag 组合
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

      // 4. 降级
      return tag;
    },

    // 创建顶部浮动工具栏
    _createToolbar() {
      if (this._toolbar) this._toolbar.remove();
      const types = this._modeTypes[this._mode] || [];
      const bar = document.createElement('div');
      bar.id = 'bqg-picker-toolbar';
      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span id="bqg-picker-drag-handle" title="拖动工具栏">⠇</span>
          <span style="font-weight:700;font-size:13px;color:#fff;white-space:nowrap;">
            🎯 手动标记（${this._mode === 'toc' ? '目录页' : '内容页'}）
          </span>
          <div id="bqg-picker-badges" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${types.map(t => `
              <span class="bqg-picker-badge" data-key="${t.key}" title="${t.desc}">
                ${t.label}${t.required ? ' <em style="color:#ffb74d;font-style:normal;">*</em>' : ''}
              </span>`).join('')}
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;flex-shrink:0;">
            <button id="bqg-picker-done"   style="background:#43a047;color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">✓ 完成</button>
            <button id="bqg-picker-cancel" style="background:#e53935;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;">✗ 取消</button>
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
        showToast('已取消手动标记', 'info');
      });

      // 拖拽逻辑：拖拽手柄 mousedown → 计算偏移 → mousemove 跟随光标
      const handle = bar.querySelector('#bqg-picker-drag-handle');
      let dragging = false, ox = 0, oy = 0;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        // 拖拽时取消 transform，改用绝对坐标
        const rect = bar.getBoundingClientRect();
        bar.style.setProperty('transform', 'none', 'important');
        bar.style.setProperty('left', rect.left + 'px', 'important');
        bar.style.setProperty('top',  rect.top  + 'px', 'important');
        ox = e.clientX - rect.left;
        oy = e.clientY - rect.top;
        // 拖拽期间暂停高亮以防误触
        this._dragging = true;
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const bw = bar.offsetWidth,  bh = bar.offsetHeight;
        let nx = e.clientX - ox;
        let ny = e.clientY - oy;
        nx = Math.max(0, Math.min(vw - bw, nx));
        ny = Math.max(0, Math.min(vh - bh, ny));
        bar.style.setProperty('left', nx + 'px', 'important');
        bar.style.setProperty('top',  ny + 'px', 'important');
      });
      document.addEventListener('mouseup', () => {
        if (dragging) { dragging = false; this._dragging = false; }
      });
    },

    // 刷新工具栏 badge 已标记状态
    _refreshBadges() {
      if (!this._toolbar) return;
      const types = this._modeTypes[this._mode] || [];
      types.forEach(t => {
        const badge = this._toolbar.querySelector(`.bqg-picker-badge[data-key="${t.key}"]`);
        if (!badge) return;
        if (this._picked[t.key]) {
          badge.classList.add('bqg-picker-badge-done');
          badge.title = `已选: ${this._picked[t.key]}`;
        } else {
          badge.classList.remove('bqg-picker-badge-done');
        }
      });
    },

    // 绑定全局鼠标监听
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
      document.addEventListener('click',     this._onMouseClick, true);
    },

    _removeMouseListeners() {
      if (this._onMouseMove)  document.removeEventListener('mouseover', this._onMouseMove,  true);
      if (this._onMouseClick) document.removeEventListener('click',     this._onMouseClick, true);
    },

    _clearHighlight() {
      if (this._highlight) {
        this._highlight.classList.remove('bqg-picker-highlight');
        this._highlight = null;
      }
    },

    // 显示气泡类型选择菜单（带层级导航）
    _showMenu(el, cx, cy) {
      // 移除旧的 outsideClick 监听器
      if (this._outsideClickHandler) {
        document.removeEventListener('click', this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }

      if (this._menu) { this._menu.remove(); this._menu = null; }
      const types = this._modeTypes[this._mode] || [];

      // 构建元素层级路径（从 body 到当前元素）
      const buildElementPath = (element) => {
        const path = [];
        let current = element;

        while (current && current !== document.body) {
          const tagName = current.tagName.toLowerCase();
          const id = current.id ? `#${current.id}` : '';
          const className = current.className && typeof current.className === 'string'
            ? `.${current.className.split(' ')[0]}`
            : '';

          // 生成描述性标签
          let label = tagName;
          if (id) label += id;
          else if (className) label += className;

          // 获取元素的简短内容作为提示（最多20字）
          let contentHint = '';
          if (current.children.length === 0) {
            const text = current.textContent?.trim().slice(0, 20) || '';
            if (text) contentHint = `: "${text}${current.textContent.length > 20 ? '...' : ''}"`;
          }

          path.push({
            element: current,
            label: label + contentHint,
            tagName: tagName,
            selector: this.generateSelector(current)
          });

          current = current.parentElement;
        }

        return path.reverse(); // 反转，从 body 到目标元素
      };

      const elementPath = buildElementPath(el);

      const menu = document.createElement('div');
      menu.id = 'bqg-picker-menu';
      menu.innerHTML = `
        <!-- 元素层级导航 -->
        <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #e0e0e0;">
          <div style="font-size:11px;color:#666;margin-bottom:8px;">📍 元素路径（点击选择层级）：</div>
          <div class="bqg-picker-breadcrumb" style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;">
            ${elementPath.map((item, index) => `
              <span class="bqg-picker-crumb ${index === elementPath.length - 1 ? 'bqg-picker-crumb-active' : ''}"
                data-index="${index}"
                data-selector="${item.selector}"
                title="${item.label}">
                ${item.label}
              </span>
            `).join('<span style="color:#999;"> › </span>')}
          </div>
          <div style="font-size:10px;color:#999;margin-top:6px;">
            💡 提示：点击上方层级可切换到父元素
          </div>
        </div>

        <!-- 当前选中元素的选择器 -->
        <div style="font-size:11px;color:#999;margin-bottom:8px;word-break:break-all;">
          <code class="bqg-picker-selector-code" style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:11px;">${this.generateSelector(el)}</code>
        </div>

        <!-- 类型选择 -->
        <div style="font-size:12px;color:#666;margin-bottom:10px;">请选择此元素的类型：</div>
        ${types.map(t => {
          const done = this._picked[t.key] ? '✓ ' : '';
          return `<div class="bqg-picker-menu-item bqg-picker-type-item ${this._picked[t.key] ? 'bqg-picker-menu-done' : ''}"
            data-key="${t.key}" title="${t.desc}">${done}${t.label}</div>`;
        }).join('')}
        <div class="bqg-picker-menu-item bqg-picker-menu-cancel">✗ 不标记</div>`;
      document.body.appendChild(menu);
      this._menu = menu;

      // 保存元素路径供后续使用
      this._currentElementPath = elementPath;
      this._currentSelectedElement = el;

      // 先设初始位置，渲染后修正溢出
      menu.style.left = (cx + 8) + 'px';
      menu.style.top  = (cy + 8) + 'px';
      requestAnimationFrame(() => {
        if (!this._menu) return;
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        const vw = window.innerWidth,  vh = window.innerHeight;
        let mx = cx + 8, my = cy + 8;
        if (mx + mw > vw - 10) mx = cx - mw - 8;
        if (my + mh > vh - 10) my = cy - mh - 8;
        menu.style.left = Math.max(4, mx) + 'px';
        menu.style.top  = Math.max(4, my) + 'px';
      });

      // 点击菜单项
      menu.addEventListener('click', (e) => {
        // 1. 处理面包屑点击（切换元素层级）
        const crumb = e.target.closest('.bqg-picker-crumb');
        if (crumb) {
          e.stopPropagation();
          const index = parseInt(crumb.dataset.index);
          const elementPath = this._currentElementPath;
          const selectedEl = elementPath[index].element;

          // 更新高亮元素
          if (this._highlight) {
            this._highlight.classList.remove('bqg-picker-highlight');
          }
          selectedEl.classList.add('bqg-picker-highlight');
          this._highlight = selectedEl;

          // 更新选择器显示
          const newSel = this.generateSelector(selectedEl);
          menu.querySelector('.bqg-picker-selector-code').textContent = newSel;

          // 更新面包屑激活状态
          menu.querySelectorAll('.bqg-picker-crumb').forEach((c, i) => {
            if (i <= index) {
              c.classList.add('bqg-picker-crumb-active');
            } else {
              c.classList.remove('bqg-picker-crumb-active');
            }
          });

          // 保存当前选择的元素
          this._currentSelectedElement = selectedEl;
          return;
        }

        // 2. 处理类型选择项点击
        const item = e.target.closest('.bqg-picker-menu-item');
        if (!item) return;
        e.stopPropagation();
        if (item.classList.contains('bqg-picker-menu-cancel')) {
          menu.remove(); this._menu = null;
          return;
        }

        const key = item.dataset.key;
        const typeInfo = types.find(t => t.key === key);

        // 使用当前选择的元素（可能是通过面包屑选择的）
        const selectedEl = this._currentSelectedElement || el;
        const sel = this.generateSelector(selectedEl);

        this._picked[key] = sel;

        // 标记目录容器时，自动推导章节链接选择器
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
              showToast(
                `📋 目录容器已标记（发现 ${links.length} 个章节链接）\n自动推导章节选择器: ${chapSel}`,
                'success', 3500
              );
            } else {
              showToast(`📋 目录容器已标记，但未发现链接，请确认选择器`, 'warn', 3000);
            }
          }
        } else {
          showToast(`${typeInfo ? typeInfo.label : key} 已标记\n选择器: ${sel}`, 'success', 2500);
        }

        // 保持绿色边框提示用户已标记
        selectedEl.classList.remove('bqg-picker-highlight');
        selectedEl.classList.add('bqg-picker-marked');
        menu.remove(); this._menu = null;
        this._refreshBadges();

        // 清除临时状态
        this._currentSelectedElement = null;
      });

      // 点击菜单外部关闭
      this._outsideClickHandler = (e) => {
        if (this._menu && !this._menu.contains(e.target)) {
          this._menu.remove();
          this._menu = null;
          document.removeEventListener('click', this._outsideClickHandler, true);
          this._outsideClickHandler = null;
        }
      };
      setTimeout(() => document.addEventListener('click', this._outsideClickHandler, true), 20);
    },

    // 完成标记：校验 → 组装规则 → 保存
    finish() {
      const types = this._modeTypes[this._mode] || [];
      const missing = types.filter(t => t.required && !this._picked[t.key]).map(t => t.label);
      if (missing.length > 0) {
        showToast(`⚠️ 请先标记必选项：${missing.join('、')}`, 'warn', 3500);
        return;
      }

      const currentHostname = window.location.hostname;

      let rule;
      if (this._mode === 'toc') {
        rule = {
          name:     currentHostname,
          hostname: currentHostname,  // 添加 hostname 字段用于精确匹配
          toc:      this._picked.toc,
          chapters: this._picked.chapters || (this._picked.toc + ' a[href]'),
          content:  ['div#content', '#chaptercontent', '.content'],
          title:    this._picked.title,
          bookInfo: this._picked.bookInfo || ''
        };
      } else {
        // 内容页规则：复用已有目录规则中的 toc/chapters/title
        const base = currentSiteSelector || {};
        rule = {
          name:     currentHostname,
          hostname: currentHostname,  // 添加 hostname 字段用于精确匹配
          toc:      base.toc      || '',
          chapters: base.chapters || '',
          title:    base.title    || 'h1',
          bookInfo: base.bookInfo || '',
          content:  [this._picked.content],
          nextPage: this._picked.nextPage || ''
        };
      }

      if (SiteRuleManager.addRule(rule)) {
        // 立即让本次下载生效
        currentSiteSelector = { ...rule, custom: true };
        this.stop();
        showToast(`✅ 规则已保存并立即生效！`, 'success', 3500);
        if (this._onComplete) this._onComplete(rule);
      } else {
        showToast('保存规则失败，请查看控制台（F12）', 'error');
      }
    }
  };

  // 内容检测系统
  const ContentDetector = {
    // Simhash算法：检测重复内容
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

      // 检测404或错误提示，提取命中关键词前后文字作为具体原因
      // 明确错误标识（任意长度都检测）
      const strictErrorRe = /404|not\s*found|章节不存在/i;
      // 模糊错误词（仅内容过短时才检测，避免误报正常小说对话）
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

      // [已移除] 标题与内容匹配检测 - 章节标题不一定出现在正文中

      return issues;
    }
  };

  // 速度图表系统
  // 内容清洗正则库（从 CleanRuleManager 动态加载）
  let CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();


  GM_addStyle(`
        /* 弹窗基础样式 - 现代化毛玻璃效果 */
        #fetchContentModal, #configModal {
            display: flex;
            flex-direction: column;
            border-radius: 16px;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 0;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 
                        0 0 0 1px rgba(255, 255, 255, 0.1) inset;
            z-index: 10000;
            width: 520px;
            max-height: 90vh;
            overflow: hidden;
            animation: modalFadeIn 0.3s ease-out;
            backdrop-filter: blur(10px);
        }
        
        @keyframes modalFadeIn {
            from {
                opacity: 0;
                transform: translate(-50%, -48%);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%);
            }
        }
        
        #configModal {
            width: 460px;
        }
        
        /* 内容区域（白色背景） */
        #fetchContentModal > *, #configModal > * {
            position: relative;
        }
        
        #fetchContentModal::after, #configModal::after {
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
        
        /* 标题栏 */
        #fetchContentModal h3, #configModal h3 {
            margin: 0;
            padding: 20px 24px;
            font-size: 18px;
            font-weight: 600;
            color: white;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            position: relative;
        }
        
        /* 关闭按钮 */
        #fetcModalClose, #configModalClose {
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
        
        #fetcModalClose:hover, #configModalClose:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: rotate(90deg);
        }
        
        /* 设置按钮 */
        #configBtn {
            cursor: pointer;
            float: right;
            margin: -2px 8px 0 0;
            width: 28px;
            height: 28px;
            line-height: 28px;
            text-align: center;
            font-size: 18px;
            border-radius: 8px;
            transition: all 0.2s ease;
            background: rgba(255, 255, 255, 0.1);
        }
        
        #configBtn:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: rotate(60deg);
        }
        
        /* 表单内容区域 */
        #fetchContentModal label, #configModal label {
            display: block;
            font-size: 14px;
            color: #333;
            padding: 0 24px;
        }
        
        #fetchContentModal label[for="ranges"] {
            margin-top: 20px;
            margin-bottom: 12px;
            font-weight: 600;
            color: #555;
        }
        
        #_book_info {
            margin-top: 20px;
            padding: 12px 24px !important;
            background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
            border-radius: 8px;
            margin-left: 24px;
            margin-right: 24px;
            font-weight: 500;
            color: #667eea;
        }
        
        /* 输入框美化 */
        input[type="number"] {
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 14px;
            transition: all 0.3s ease;
            text-align: center;
            -moz-appearance: textfield;
            appearance: textfield;
            background: white;
        }
        
        input[type="number"]:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        input[type="number"]::-webkit-inner-spin-button, 
        input[type="number"]::-webkit-outer-spin-button {
            -webkit-appearance: inner-spin-button;
            opacity: 1;
        }
        
        #fetchContentModal input[type="number"] {
            width: auto;
            margin: 2px 3px;
        }
        
        /* 表格样式 */
        #fetchContentModal table {
            margin: 0 24px 20px 24px;
            width: calc(100% - 48px) !important;
        }
        
        #fetchContentModal td {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 220px;
            color: #666;
            font-size: 13px;
        }
        
        /* 按钮美化 */
        button {
            border: none;
            padding: 12px 24px;
            font-size: 15px;
            font-weight: 600;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }
        
        button:hover::before {
            width: 300px;
            height: 300px;
        }
        
        #fetchContentButton {
            width: calc(100% - 48px);
            margin: 10px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        #fetchContentButton:hover {
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            transform: translateY(-2px);
        }
        
        #fetchContentButton:active {
            transform: translateY(0);
        }
        
        /* 进度条美化 */
        #fetchContentProgress {
            width: calc(100% - 48px);
            margin: 10px 24px;
            background: #f0f0f0;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        #fetchContentProgress div {
            width: 0;
            height: 24px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            text-align: center;
            line-height: 24px;
            color: white;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            transition: width 0.3s ease;
            box-shadow: 0 0 10px rgba(102, 126, 234, 0.5);
        }
        
        #fetchContentProgress div.progress-warning {
            background: linear-gradient(90deg, #ff9800 0%, #ff6f00 100%) !important;
            box-shadow: 0 0 10px rgba(255, 152, 0, 0.5);
        }
        
        #fetchContentProgress div.progress-error {
            background: linear-gradient(90deg, #f44336 0%, #d32f2f 100%) !important;
            box-shadow: 0 0 10px rgba(244, 67, 54, 0.5);
        }
        
        /* 配置项样式 */
        .config-item {
            margin: 18px 0;
            padding: 0 24px;
            text-align: left;
        }
        
        .config-item label {
            display: inline-block;
            width: 160px;
            font-weight: 600;
            color: #333;
            padding: 0;
        }
        
        .config-item input {
            width: 80px;
            padding: 8px 12px;
        }
        
        .config-item small {
            color: #999;
            margin-left: 8px;
            font-size: 12px;
        }
        
        #saveConfigButton {
            width: calc(100% - 48px);
            margin: 24px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        #saveConfigButton:hover {
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            transform: translateY(-2px);
        }
        
        /* 失败章节信息样式 */
        #failedChaptersInfo {
            margin: 10px 24px;
            padding: 16px;
            background: linear-gradient(135deg, #fff3cd 0%, #ffe8a1 100%);
            border: none;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(255, 193, 7, 0.2);
            max-height: 160px;
            overflow-y: auto;
        }
        
        #failedChaptersInfo > div:first-child {
            font-weight: 600;
            margin-bottom: 8px;
            color: #856404;
        }
        
        #failedChaptersList {
            font-size: 12px;
            color: #856404;
        }
        
        #retryFailedButton {
            width: 100%;
            margin-top: 12px;
            background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%);
            color: white;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
        }
        
        #retryFailedButton:hover {
            box-shadow: 0 4px 12px rgba(255, 152, 0, 0.5);
            transform: translateY(-1px);
        }
        
        /* 警告信息 */
        #_warn_info {
            color: #666;
            font-size: 13px;
            margin: 8px 24px;
            line-height: 1.6;
        }
        
        /* 下载链接 */
        #_downlink {
            display: block;
            margin: 12px 24px 24px 24px;
            padding: 10px;
            text-align: center;
            color: #667eea;
            text-decoration: none;
            border-radius: 8px;
            transition: all 0.3s ease;
            font-size: 13px;
        }
        
        #_downlink:hover {
            background: rgba(102, 126, 234, 0.1);
        }
        
        /* 弹窗内容滚动区域 */
        .modal-body {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
            padding-bottom: 8px;
        }
        
        .modal-body::-webkit-scrollbar {
            width: 6px;
        }
        
        .modal-body::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .modal-body::-webkit-scrollbar-thumb {
            background: rgba(102, 126, 234, 0.25);
            border-radius: 3px;
        }
        
        .modal-body::-webkit-scrollbar-thumb:hover {
            background: rgba(102, 126, 234, 0.45);
        }
        
        /* 滚动条美化 */
        #failedChaptersInfo::-webkit-scrollbar {
            width: 6px;
        }
        
        #failedChaptersInfo::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.05);
            border-radius: 3px;
        }
        
        #failedChaptersInfo::-webkit-scrollbar-thumb {
            background: rgba(133, 100, 4, 0.3);
            border-radius: 3px;
        }
        
        #failedChaptersInfo::-webkit-scrollbar-thumb:hover {
            background: rgba(133, 100, 4, 0.5);
        }
        
        /* Toast 通知 */
        @keyframes bqgToastIn {
            from { opacity: 0; transform: translateX(-50%) translateY(12px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .bqg-toast {
            position: fixed;
            bottom: 28px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
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
        .bqg-toast.error   { background: #e53935; }
        .bqg-toast.info    { background: #1976d2; }
        .bqg-toast.warn    { background: #f57c00; }

        /* =============================================================
           手动标记器 ElementPicker
           ============================================================= */
        html.bqg-picker-mode * {
            cursor: crosshair !important;
        }
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
            box-sizing: border-box !important;
            border-radius: 12px !important;
            width: max-content !important;
            max-width: 92vw !important;
            user-select: none !important;
        }
        #bqg-picker-drag-handle {
            cursor: move !important;
            padding: 2px 8px 2px 4px;
            opacity: 0.7;
            font-size: 16px;
            line-height: 1;
            color: #fff;
            flex-shrink: 0;
        }
        #bqg-picker-drag-handle:hover { opacity: 1; }
        .bqg-picker-badge {
            display: inline-block;
            padding: 4px 10px;
            background: rgba(255,255,255,0.18);
            color: #fff;
            border-radius: 20px;
            font-size: 12px;
            border: 1px solid rgba(255,255,255,0.3);
            transition: background 0.2s;
            white-space: nowrap;
        }
        .bqg-picker-badge-done {
            background: rgba(67, 160, 71, 0.8) !important;
            border-color: #a5d6a7 !important;
        }
        #bqg-picker-menu {
            position: fixed !important;
            z-index: 2147483646 !important;
            background: #fff !important;
            border-radius: 10px !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.22) !important;
            padding: 12px !important;
            min-width: 200px !important;
            max-width: 320px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
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
        .bqg-picker-menu-item:hover {
            background: #f0f4ff;
        }
        .bqg-picker-menu-done {
            color: #43a047 !important;
            font-weight: 600;
        }
        .bqg-picker-menu-cancel {
            color: #e53935 !important;
            border-top: 1px solid #f0f0f0;
            margin-top: 4px;
            padding-top: 10px;
        }
        /* 元素层级面包屑样式 */
        .bqg-picker-crumb {
            padding: 4px 8px;
            background: #f0f0f0;
            border-radius: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
            border: 1px solid transparent;
        }
        .bqg-picker-crumb:hover {
            background: #e3f2fd;
            border-color: #2196f3;
            color: #1976d2;
        }
        .bqg-picker-crumb-active {
            background: #2196f3;
            color: white;
            border-color: #1976d2;
            font-weight: 600;
        }
    `);

  // Toast 通知（自动消失，无需点击）
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

  const modalHtml = `
        <div id="fetchContentModal" style="display:none;">
            <h3>小说下载工具<span id="fetcModalClose">✕</span><span id="configBtn" title="设置">⚙️</span></h3>
            <div class="modal-body">
            <label id="_book_info"></label>
            <div style="margin:10px 24px; padding:12px; background:rgba(102,126,234,0.05); border-radius:8px;">
                <label style="font-size:12px; color:#667eea; font-weight:600; display:block; margin-bottom:8px;">📚 文件名标题选择</label>
                <select id="_title_select" style="width:100%; padding:8px; border-radius:6px; border:1px solid #e0e0e0; font-size:13px; margin-bottom:8px;">
                    <option value="">自动检测（推荐）</option>
                </select>
                <input type="text" id="_title_custom" placeholder="或输入自定义标题" style="width:100%; padding:8px; border-radius:6px; border:1px solid #e0e0e0; font-size:13px; box-sizing:border-box;">
            </div>
            <label for="ranges">下载章节范围：</label>
            <table style="width:100%; margin-bottom:10px; table-layout:fixed;">
              <tbody>
                 <colgroup>
                  <col style="width: 45%;">
                  <col style="width: 10%;">
                  <col style="width: 45%;">
                </colgroup>
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
            <div style="display:flex; gap:10px; margin:10px 24px;">
                <button id="previewButton" style="flex:1; background:linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%); color:white; padding:10px; border-radius:8px;">📖 预览章节</button>
                <button id="ruleManageButton" style="flex:1; background:linear-gradient(135deg, #66bb6a 0%, #43a047 100%); color:white; padding:10px; border-radius:8px;">⚙️ 规则管理</button>
            </div>
            <div style="display:flex; gap:10px; margin:10px 24px;">
                <button id="analyzeTocButton" style="flex:1; background:linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); color:white; padding:10px; border-radius:8px;">🔍 分析章节规则</button>
                <button id="analyzeContentButton" style="flex:1; background:linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%); color:white; padding:10px; border-radius:8px;">🔧 分析内容规则</button>
            </div>
            <div style="display:flex; gap:10px; margin:10px 24px;">
                <button id="pickTocButton" style="flex:1; background:linear-gradient(135deg, #26c6da 0%, #0097a7 100%); color:white; padding:10px; border-radius:8px;">🎯 手动标记目录页</button>
                <button id="pickContentButton" style="flex:1; background:linear-gradient(135deg, #ef5350 0%, #c62828 100%); color:white; padding:10px; border-radius:8px;">🎯 手动标记内容页</button>
            </div>
            <button id="fetchContentButton">开始下载</button>
            <div id="fetchContentProgress">
                <div></div>
            </div>
            <div id="detectionResultsContainer" style="display:none; margin:10px 24px; padding:12px; background:rgba(255,152,0,0.1); border-radius:8px; max-height:120px; overflow-y:auto;">
                <div style="font-size:12px; color:#ff6f00; font-weight:600; margin-bottom:8px;">⚠️ 内容质量检测</div>
                <div id="detectionResults" style="font-size:11px; color:#666;"></div>
            </div>
            <div id="failedChaptersInfo" style="display:none; margin:10px 0; padding:10px; background:#fff3cd; border:1px solid #ffc107; border-radius:5px; text-align:left; max-height:150px; overflow-y:auto;">
                <div style="font-weight:bold; margin-bottom:5px; color:#856404;">失败章节列表：</div>
                <div id="failedChaptersList" style="font-size:12px; color:#856404;"></div>
                <button id="retryFailedButton" style="width:100%; margin-top:8px; background:#ffc107; border:none; padding:5px; cursor:pointer; border-radius:3px;">重试失败章节</button>
            </div>
            <a id="_downlink"></a>
            </div><!-- /.modal-body -->
        </div>
        <div id="configModal" style="display:none;">
            <h3>下载设置<span id="configModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
            <div class="modal-body">
            <div class="config-item">
                <label>并发请求数：</label>
                <input type="number" id="config_concurrency" min="1" max="20" value="8">
                <small>(1-20)</small>
            </div>
            <div class="config-item">
                <label>失败重试次数：</label>
                <input type="number" id="config_retries" min="0" max="10" value="3">
                <small>(0-10)</small>
            </div>
            <div class="config-item">
                <label>iframe超时(秒)：</label>
                <input type="number" id="config_timeout" min="5" max="60" value="10">
                <small>(5-60)</small>
            </div>
            <div class="config-item">
                <label>最小内容长度：</label>
                <input type="number" id="config_minlength" min="10" max="200" value="50">
                <small>(10-200字)</small>
            </div>
            <div class="config-item" style="border-top:1px solid #e0e0e0; padding-top:12px; margin-top:12px;">
                <label style="color:#ff6f00;">智能限流下限：</label>
                <input type="number" id="config_throttle_min" min="1" max="20" value="3">
                <small>(1-20)</small>
            </div>
            <div class="config-item">
                <label style="color:#ff6f00;">智能限流上限：</label>
                <input type="number" id="config_throttle_max" min="1" max="30" value="15">
                <small>(1-30)</small>
            </div>
            <div style="border-top:1px solid #e0e0e0; padding-top:12px; margin-top:12px;">
                <button id="manageCleanRulesButton" style="background:linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); color:white; padding:10px 20px; border-radius:8px; font-size:13px; width:calc(100% - 48px); margin:0 24px;">
                    🧹 内容清洗规则管理
                </button>
            </div>
            <div style="border-top:1px solid #e0e0e0; padding-top:12px; margin-top:12px;">
                <label style="display:flex; align-items:center; justify-content:center; margin-bottom:10px;">
                    <input type="checkbox" id="config_disable_resume" style="margin-right:8px;">
                    <span>禁用断点续传（每次重新下载）</span>
                </label>
                <div style="padding:0 24px;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px;">
                        <button class="cache-clear-btn" data-type="progress" style="background:#ff9800; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; border:none;">📥 下载进度</button>
                        <button class="cache-clear-btn" data-type="config" style="background:#2196f3; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; border:none;">⚙️ 配置设置</button>
                        <button class="cache-clear-btn" data-type="rules" style="background:#4caf50; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; border:none;">📋 清洗规则</button>
                        <button class="cache-clear-btn" data-type="sites" style="background:#9c27b0; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; border:none;">🌐 站点规则</button>
                    </div>
                    <button id="clearAllCacheButton" style="background:#e53935; color:white; padding:10px 20px; border-radius:8px; font-size:13px; width:100%; cursor:pointer; border:none;">
                        🗑️ 清除所有缓存数据
                    </button>
                </div>
            </div>
            <button id="saveConfigButton">保存设置</button>
            </div><!-- /.modal-body -->
        </div>
        <div id="previewModal" style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:16px; padding:0; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:10001; width:600px; max-height:90vh; flex-direction:column; display:none;">
            <h3 style="background:linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%); color:white; padding:20px 24px; margin:0; border-radius:16px 16px 0 0; flex-shrink:0;">章节预览<span id="previewModalClose" style="cursor:pointer; float:right; margin:-2px 0;">✕</span></h3>
            <div id="previewContent" style="padding:20px 24px; overflow-y:auto; font-size:13px; color:#666; line-height:1.8; flex:1; min-height:0;"></div>
            <div style="padding:0 24px 20px 24px; display:flex; gap:10px; flex-shrink:0;">
                <button id="skipPreviewButton" style="flex:1; background:#e0e0e0; color:#666; padding:10px; border-radius:8px;">跳过预览</button>
                <button id="continueDownloadButton" style="flex:1; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; padding:10px; border-radius:8px;">继续下载</button>
            </div>
        </div>
        <div id="ruleAnalyzerModal" style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:16px; padding:0; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:10002; width:700px; max-height:90vh; flex-direction:column; display:none;">
            <h3 id="analyzerModalTitle" style="background:linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); color:white; padding:20px 24px; margin:0; border-radius:16px 16px 0 0; flex-shrink:0;">智能规则分析<span id="analyzerModalClose" style="cursor:pointer; float:right; margin:-2px 0;">✕</span></h3>
            <div id="analyzerContent" style="padding:20px 24px; overflow-y:auto; font-size:13px; color:#666; line-height:1.8; flex:1; min-height:0;"></div>
            <div style="padding:0 24px 20px 24px; display:flex; gap:10px; flex-shrink:0;">
                <button id="applyRuleButton" style="flex:1; background:linear-gradient(135deg, #66bb6a 0%, #43a047 100%); color:white; padding:10px; border-radius:8px;">✓ 应用规则</button>
                <button id="exportAnalyzedRuleButton" style="flex:1; background:linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%); color:white; padding:10px; border-radius:8px;">📤 导出规则</button>
                <button id="closeAnalyzerButton" style="flex:1; background:#e0e0e0; color:#666; padding:10px; border-radius:8px;">关闭</button>
            </div>
        </div>
        <div id="ruleModal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:16px; padding:0; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:10001; width:700px; max-height:600px;">
            <h3 style="background:linear-gradient(135deg, #66bb6a 0%, #43a047 100%); color:white; padding:20px 24px; margin:0; border-radius:16px 16px 0 0;">站点规则管理<span id="ruleModalClose" style="cursor:pointer; float:right; margin:-2px 0;">✕</span></h3>
            <div style="padding:20px 24px; max-height:450px; overflow-y:auto;">
                <div style="margin-bottom:15px; text-align:right;">
                    <button id="addRuleButton" style="background:#4fc3f7; color:white; padding:8px 16px; border-radius:6px; font-size:13px;">➕ 添加规则</button>
                    <button id="importRulesButton" style="background:#66bb6a; color:white; padding:8px 16px; border-radius:6px; font-size:13px; margin-left:8px;">📥 导入</button>
                    <button id="exportRulesButton" style="background:#ffa726; color:white; padding:8px 16px; border-radius:6px; font-size:13px; margin-left:8px;">📤 导出</button>
                </div>
                <div id="rulesList" style="font-size:13px;"></div>
            </div>
        </div>
        <div id="cleanRuleModal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:16px; padding:0; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:10003; width:800px; max-height:650px;">
            <h3 style="background:linear-gradient(135deg, #ff9800 0%, #ff6f00 100%); color:white; padding:20px 24px; margin:0; border-radius:16px 16px 0 0;">🧹 内容清洗规则管理<span id="cleanRuleModalClose" style="cursor:pointer; float:right; margin:-2px 0;">✕</span></h3>
            <div style="padding:20px 24px; max-height:520px; overflow-y:auto;">
                <div style="margin-bottom:15px; padding:12px; background:#fff3cd; border-radius:8px; font-size:12px; color:#856404;">
                    <strong>💡 提示：</strong>清洗规则使用正则表达式匹配并删除内容中的垃圾文本。内置规则可禁用，自定义规则可编辑删除。
                </div>
                <div style="margin-bottom:15px; text-align:right;">
                    <button id="addCleanRuleButton" style="background:#4fc3f7; color:white; padding:8px 16px; border-radius:6px; font-size:13px;">➕ 添加规则</button>
                    <button id="importCleanRulesButton" style="background:#66bb6a; color:white; padding:8px 16px; border-radius:6px; font-size:13px; margin-left:8px;">📥 导入</button>
                    <button id="exportCleanRulesButton" style="background:#ffa726; color:white; padding:8px 16px; border-radius:6px; font-size:13px; margin-left:8px;">📤 导出</button>
                    <button id="resetCleanRulesButton" style="background:#e53935; color:white; padding:8px 16px; border-radius:6px; font-size:13px; margin-left:8px;">🔄 重置</button>
                </div>
                <div id="cleanRulesList" style="font-size:13px;"></div>
            </div>
        </div>
    `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // 获取元素
  const modal = document.getElementById('fetchContentModal');
  const configModal = document.getElementById('configModal');
  const startRangeInput = document.getElementById('_startRange');
  const finalRangeInput = document.getElementById('_finalRange');

  const startTitle = document.getElementById('_startRange_title');
  const finalTitle = document.getElementById('_finalRange_title');

  const fetchButton = document.getElementById('fetchContentButton');
  const progressBar = document.getElementById('fetchContentProgress').firstElementChild;
  const downlink = document.getElementById('_downlink');
  const warnInfo = document.getElementById('_warn_info');
  const bookInfo = document.getElementById('_book_info');
  const titleSelect = document.getElementById('_title_select');
  const titleCustom = document.getElementById('_title_custom');
  const fetcClose = document.getElementById('fetcModalClose');
  const configBtn = document.getElementById('configBtn');
  const configModalClose = document.getElementById('configModalClose');
  const saveConfigButton = document.getElementById('saveConfigButton');
  const failedChaptersInfo = document.getElementById('failedChaptersInfo');
  const failedChaptersList = document.getElementById('failedChaptersList');
  const retryFailedButton = document.getElementById('retryFailedButton');
  
  // 新增元素获取
  const previewButton = document.getElementById('previewButton');
  const ruleManageButton = document.getElementById('ruleManageButton');
  const previewModal = document.getElementById('previewModal');
  const previewModalClose = document.getElementById('previewModalClose');
  const previewContent = document.getElementById('previewContent');
  const skipPreviewButton = document.getElementById('skipPreviewButton');
  const continueDownloadButton = document.getElementById('continueDownloadButton');
  const ruleModal = document.getElementById('ruleModal');
  const ruleModalClose = document.getElementById('ruleModalClose');
  const rulesList = document.getElementById('rulesList');
  const addRuleButton = document.getElementById('addRuleButton');
  const importRulesButton = document.getElementById('importRulesButton');
  const exportRulesButton = document.getElementById('exportRulesButton');
  const detectionResultsContainer = document.getElementById('detectionResultsContainer');
  const detectionResults = document.getElementById('detectionResults');
  
  // 规则分析器元素
  const analyzeTocButton = document.getElementById('analyzeTocButton');
  const analyzeContentButton = document.getElementById('analyzeContentButton');
  const ruleAnalyzerModal = document.getElementById('ruleAnalyzerModal');
  const analyzerModalTitle = document.getElementById('analyzerModalTitle');
  const analyzerModalClose = document.getElementById('analyzerModalClose');
  const analyzerContent = document.getElementById('analyzerContent');
  const applyRuleButton = document.getElementById('applyRuleButton');
  const exportAnalyzedRuleButton = document.getElementById('exportAnalyzedRuleButton');
  const closeAnalyzerButton = document.getElementById('closeAnalyzerButton');

  // 手动标记按钮
  const pickTocButton     = document.getElementById('pickTocButton');
  const pickContentButton = document.getElementById('pickContentButton');
  
  // 清洗规则管理元素
  const manageCleanRulesButton = document.getElementById('manageCleanRulesButton');
  const cleanRuleModal = document.getElementById('cleanRuleModal');
  const cleanRuleModalClose = document.getElementById('cleanRuleModalClose');
  const cleanRulesList = document.getElementById('cleanRulesList');
  const addCleanRuleButton = document.getElementById('addCleanRuleButton');
  const importCleanRulesButton = document.getElementById('importCleanRulesButton');
  const exportCleanRulesButton = document.getElementById('exportCleanRulesButton');
  const resetCleanRulesButton = document.getElementById('resetCleanRulesButton');

  let booktitle = null;
  let tocDiv = null;
  let chapters = null;
  let abortController = null;
  let isDownloading = false;
  let failedChapters = [];
  let downloadStartTime = 0;
  let openedFromMenu = false; // 标记是否从菜单打开
  let currentSiteSelector = null; // 当前站点选择器
  let responseTimes = []; // 记录响应时间（用于智能限流）
  let lastSaveTime = 0; // 进度保存节流时间戳

  let startIndex, finalIndex;
  let results = []; // 章节内容数组
  let selectedLinks = []; // 选中的章节链接
  let totalLinks = 0; // 总章节数
  let completedRequests = 0; // 已完成请求数
  let progressUpdateInterval = null; // 进度条实时更新定时器

  // 实时更新进度条（提取为函数，供定时器调用）
  function updateProgressBar() {
    if (!isDownloading || totalLinks === 0) return;
    
    const progress = Math.round((completedRequests / totalLinks) * 100);
    const elapsed = (Date.now() - downloadStartTime) / 1000;
    const speed = elapsed > 0 ? (completedRequests / elapsed).toFixed(2) : '0.00';
    const remaining = speed > 0 ? Math.ceil((totalLinks - completedRequests) / speed / 60) : 0;
    
    progressBar.style.width = `${progress}%`;
    progressBar.textContent = `${progress}% (${completedRequests}/${totalLinks}) | ${speed}章/秒 | 剩余${remaining}分钟`;
    
    // 进度条颜色语义化（根据失败率）
    if (completedRequests > 0) {
      const failureRate = failedChapters.length / completedRequests;
      progressBar.classList.remove('progress-warning', 'progress-error');
      if (failureRate > 0.2) {
        progressBar.classList.add('progress-error'); // 失败率>20%：红色
      } else if (failureRate > 0.05) {
        progressBar.classList.add('progress-warning'); // 失败率>5%：橙色
      }
    }
    
  }

  // 检测站点结构（选择器策略模式）
  function detectSiteStructure() {
    const currentHostname = window.location.hostname;

    // 1. 优先检查自定义规则中是否有 hostname 精确匹配
    const customRules = SiteRuleManager.getCustomRules();
    const hostnameMatchedRule = customRules.find(rule =>
      rule.hostname && rule.hostname === currentHostname
    );

    if (hostnameMatchedRule) {
      console.log(`[站点检测] 使用自定义规则（hostname匹配）: ${hostnameMatchedRule.name}`);
      return hostnameMatchedRule;
    }

    // 2. 遍历内置规则（包括自定义规则中无 hostname 的）
    const allRules = SiteRuleManager.getAllRules();
    for (const selector of allRules) {
      // 检查基本 toc 选择器是否存在
      const tocElement = document.querySelector(selector.toc);
      if (!tocElement) continue;

      // 如果配置了 tocPattern，需要验证内容匹配
      if (selector.tocPattern) {
        // 检查 toc 元素及其前面的兄弟元素是否包含模式文本
        // 这样可以匹配 dt、h2、h3 等各种标题元素
        let patternMatched = false;

        // 首先检查 toc 元素自身的文本内容
        if (tocElement.textContent.includes(selector.tocPattern)) {
          patternMatched = true;
        } else {
          // 检查 toc 元素前面的兄弟元素（通常是标题）
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
    return SITE_SELECTORS[0]; // 默认使用第一个
  }

  // 内容清洗函数
  function cleanContent(text) {
    let cleaned = text;

    // 先应用所有正则清洗规则
    for (const pattern of CONTENT_CLEAN_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 清理只包含空白字符的行（空格、制表符等）
    cleaned = cleaned.replace(/[ \t\r]+\n/g, '\n');

    // 清理大量连续空行（2个以上换行变成1个空行）
    cleaned = cleaned.replace(/\n{2,}/g, '\n\n');

    // 清理首尾空白
    cleaned = cleaned.trim();

    return cleaned;
  }

  // 智能限流：根据响应时间动态调整并发数
  function adjustConcurrency() {
    if (responseTimes.length < CONSTANTS.PROGRESS_SAMPLE_SIZE) return;
    
    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const oldConcurrency = CONFIG.concurrency;
    
    // 使用用户配置的上下限
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

  // 收集可用的标题选项
  function collectTitleOptions() {
    const options = [];
    const seen = new Set();

    // 0. 【优先】下载按钮所在的 h1 标题
    const downloadBtnH1 = document.querySelector('button#downloadMenuBtn')?.closest('h1');
    if (downloadBtnH1) {
      const text = downloadBtnH1.childNodes[0]?.textContent?.trim() || downloadBtnH1.innerText?.replace('下载', '').trim();
      if (text) {
        options.push({ value: 'download_btn_h1', label: `📌 下载位置: ${text}`, text: text });
        seen.add(text);
      }
    }

    // 1. 页面标题
    const pageTitle = document.title?.trim();
    if (pageTitle) {
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
    if (currentSiteSelector && currentSiteSelector.title) {
      const titleElement = document.querySelector(currentSiteSelector.title);
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
  }

  // 更新标题显示
  function updateTitleDisplay() {
    const selectedValue = titleSelect.value;
    const customText = titleCustom.value.trim();

    let newTitle = null;

    if (customText) {
      newTitle = customText;
    } else if (selectedValue) {
      const option = Array.from(titleSelect.options).find(opt => opt.value === selectedValue);
      if (option) {
        newTitle = option.dataset.text;
      }
    }

    if (newTitle) {
      booktitle = newTitle;
      bookInfo.innerText = `当前小说:《${booktitle}》，共 ${chapters.length} 章。`;
      console.log(`📚 [标题更新] ${booktitle}`);
    }
  }

  /**
   * 检测是否需要分页加载
   */
  function detectPaginationNeeded(siteConfig) {
    // 1. 优先使用站点配置
    if (siteConfig.tocNextPage) {
      const nextEl = document.querySelector(siteConfig.tocNextPage);
      if (nextEl) return true;
    }

    // 2. 使用自动检测
    const paginationInfo = RuleAnalyzer.detectTocPagination();
    return paginationInfo.hasNextPage;
  }

  /**
   * 查找下一页URL
   */
  async function findNextPageUrl(currentDoc, siteConfig, currentUrl) {
    // 1. 优先使用配置的选择器
    if (siteConfig.tocNextPage) {
      const nextEl = currentDoc.querySelector(siteConfig.tocNextPage);
      if (nextEl && nextEl.href) {
        return nextEl.href.startsWith('http') ? nextEl.href : new URL(nextEl.href, currentUrl).href;
      }
    }

    // 2. 尝试文本匹配
    if (siteConfig.tocNextPagePattern) {
      const allLinks = currentDoc.querySelectorAll('a');
      for (const link of allLinks) {
        if (link.innerText.trim() === siteConfig.tocNextPagePattern) {
          return link.href.startsWith('http') ? link.href : new URL(link.href, currentUrl).href;
        }
      }
    }

    // 3. 使用自动检测结果
    const paginationInfo = RuleAnalyzer.detectTocPagination();
    if (paginationInfo.hasNextPage) {
      if (paginationInfo.nextPageSelector && !paginationInfo.nextPageSelector.includes(':has-text')) {
        const nextEl = currentDoc.querySelector(paginationInfo.nextPageSelector);
        if (nextEl && nextEl.href) {
          return nextEl.href.startsWith('http') ? nextEl.href : new URL(nextEl.href, currentUrl).href;
        }
      }

      // 尝试通过文本匹配
      if (paginationInfo.nextPagePattern) {
        const allLinks = currentDoc.querySelectorAll('a');
        for (const link of allLinks) {
          if (link.innerText.trim() === paginationInfo.nextPagePattern ||
            link.innerText.trim().toLowerCase().includes(paginationInfo.nextPagePattern.toLowerCase())) {
            return link.href.startsWith('http') ? link.href : new URL(link.href, currentUrl).href;
          }
        }
      }
    }

    return null;
  }

  /**
   * 刷新章节列表（用于手动标记后重新加载）
   */
  async function refreshChapters() {
    if (!currentSiteSelector) {
      console.error('❌ [刷新章节] currentSiteSelector 为空');
      return false;
    }

    console.log('🔄 [刷新章节] 开始重新加载章节列表...');
    console.log(`   使用规则: ${currentSiteSelector.name}`);
    console.log(`   目录选择器: ${currentSiteSelector.toc}`);
    console.log(`   章节选择器: ${currentSiteSelector.chapters}`);

    tocDiv = document.querySelector(currentSiteSelector.toc);

    if (!tocDiv) {
      console.error(`❌ [刷新章节] 未找到目录容器: ${currentSiteSelector.toc}`);
      showToast('未找到目录容器，请检查选择器是否正确', 'error');
      return false;
    }

    // 检测是否需要分页加载
    const needsPagination = detectPaginationNeeded(currentSiteSelector);

    if (needsPagination) {
      console.log('📖 [分页模式] 检测到分页，开始加载所有分页...');
      showToast('检测到分页，正在加载所有章节...', 'info');

      // 异步加载所有分页的章节
      chapters = await loadPaginatedChapters(currentSiteSelector, tocDiv);

      if (!chapters.length) {
        showToast('未找到章节列表，请检查选择器是否正确', 'error');
        return false;
      }

      console.log(`✅ [分页完成] 共获取 ${chapters.length} 个章节`);
    } else {
      console.log('📖 [单页模式] 无分页，使用单页加载');
      // 单页模式：获取章节列表
      chapters = document.querySelectorAll(currentSiteSelector.chapters);

      if (!chapters.length) {
        showToast('未找到章节列表，请检查选择器是否正确', 'error');
        return false;
      }

      // 章节去重
      const seenUrls = new Set();
      const uniqueChapters = [];
      for (const chapter of chapters) {
        const href = chapter.getAttribute('href');
        if (href && !seenUrls.has(href)) {
          seenUrls.add(href);
          uniqueChapters.push(chapter);
        }
      }
      chapters = uniqueChapters;
    }

    // 更新UI
    startRangeInput.max = chapters.length;
    finalRangeInput.max = chapters.length;
    startIndex = 0;
    finalIndex = chapters.length - 1;
    finalRangeInput.value = chapters.length;
    startTitle.innerText = chapters[startIndex].innerText;
    finalTitle.innerText = chapters[finalIndex].innerText;

    // 更新书籍信息
    bookInfo.innerText = `当前小说:《${booktitle}》，共 ${chapters.length} 章。`;

    console.log(`✅ [刷新完成] 共加载 ${chapters.length} 个章节`);
    showToast(`✅ 章节列表已刷新，共 ${chapters.length} 章`, 'success');
    return true;
  }

  /**
   * 异步加载分页章节
   */
  async function loadPaginatedChapters(siteConfig, tocDiv) {
    const allChapters = [];
    const seenUrls = new Set();
    const loadedUrls = new Set();
    let currentPageUrl = window.location.href;
    let pageCount = 0;
    const maxPages = Math.min(siteConfig.tocMaxPages || CONFIG.maxTocPages, CONFIG.maxTocPagesHardLimit);
    let currentDoc = null; // 保存当前页的文档，避免重复fetch

    console.log(`📄 [分页检测] 开始检测，最大页数: ${maxPages}`);

    try {
      while (currentPageUrl && pageCount < maxPages) {
        pageCount++;

        // 第一页：直接从当前DOM获取
        if (pageCount === 1) {
          console.log(`📄 [第 ${pageCount} 页] 从当前页面加载...`);

          // 获取第一页的章节
          const firstPageChapters = document.querySelectorAll(siteConfig.chapters);
          for (const chapter of firstPageChapters) {
            const href = chapter.getAttribute('href');
            if (href && !seenUrls.has(href)) {
              seenUrls.add(href);
              allChapters.push(chapter);
            }
          }

          console.log(`✅ [第 ${pageCount} 页] 获取 ${firstPageChapters.length} 个章节，累计 ${allChapters.length} 章`);

          // 检查是否达到章节数上限
          if (allChapters.length >= CONFIG.maxTotalChapters) {
            console.warn(`⚠️ [分页限制] 已达到最大章节数限制（${CONFIG.maxTotalChapters}章）`);
            break;
          }

          // 记录已加载的URL
          loadedUrls.add(currentPageUrl);
          currentDoc = document; // 保存第一页文档
        } else {
          // 后续页：通过fetch加载
          console.log(`📄 [第 ${pageCount} 页] 正在加载: ${currentPageUrl}`);

          // 显示加载提示
          showToast(`正在加载第 ${pageCount} 页...`, 'info');

          try {
            // 使用 GM_xmlhttpRequest 绕过 CORS 限制
            const response = await gmFetch(currentPageUrl);

            if (!response.ok) {
              console.warn(`⚠️ [第 ${pageCount} 页] 加载失败: ${response.status}`);
              break;
            }

            const html = await response.text();
            const parser = new DOMParser();
            currentDoc = parser.parseFromString(html, 'text/html');

            // 检查循环
            if (loadedUrls.has(currentPageUrl)) {
              console.warn(`⚠️ [分页循环] 检测到URL循环，停止加载`);
              break;
            }
            loadedUrls.add(currentPageUrl);

            // 提取当前页的章节
            const pageTocDiv = currentDoc.querySelector(siteConfig.toc);
            if (!pageTocDiv) {
              console.warn(`⚠️ [第 ${pageCount} 页] 未找到目录容器`);
              break;
            }

            const pageChapters = pageTocDiv.querySelectorAll(siteConfig.chapters);
            let newChapterCount = 0;

            for (const chapter of pageChapters) {
              const href = chapter.getAttribute('href');
              if (href && !seenUrls.has(href)) {
                seenUrls.add(href);
                allChapters.push(chapter);
                newChapterCount++;
              }
            }

            console.log(`✅ [第 ${pageCount} 页] 获取 ${newChapterCount} 个新章节，累计 ${allChapters.length} 章`);

            // 检查是否达到章节数上限
            if (allChapters.length >= CONFIG.maxTotalChapters) {
              console.warn(`⚠️ [分页限制] 已达到最大章节数限制（${CONFIG.maxTotalChapters}章）`);
              showToast(`已达到最大章节数限制（${CONFIG.maxTotalChapters}章）`, 'warning');
              break;
            }

            // 如果这一页没有新章节，可能已经到最后一页
            if (newChapterCount === 0) {
              console.log(`📄 [第 ${pageCount} 页] 无新章节，可能已到最后一页`);
              break;
            }

          } catch (error) {
            if (error.name === 'AbortError') {
              console.error(`⏱️ [第 ${pageCount} 页] 加载超时`);
            } else {
              console.error(`❌ [第 ${pageCount} 页] 加载失败:`, error);
            }
            break;
          }
        }

        // 查找下一页
        if (pageCount >= maxPages) {
          console.log(`📄 [分页完成] 已达到最大分页数限制（${maxPages}页）`);
          showToast(`已加载 ${pageCount} 页，共 ${allChapters.length} 章`, 'success');
          break;
        }

        // 获取下一页URL（复用当前页文档，避免重复fetch）
        currentPageUrl = await findNextPageUrl(currentDoc, siteConfig, currentPageUrl);

        if (!currentPageUrl) {
          console.log(`📄 [分页完成] 未找到下一页链接`);
          break;
        }

        // 检查下一页URL是否已在加载列表中（循环检测）
        if (loadedUrls.has(currentPageUrl)) {
          console.warn(`⚠️ [分页循环] 检测到下一页URL已加载，停止`);
          break;
        }
      }

      console.log(`🎉 [分页加载完成] 共加载 ${pageCount} 页，${allChapters.length} 个章节`);
      showToast(`分页加载完成：${pageCount} 页，${allChapters.length} 章`, 'success');

    } catch (error) {
      console.error('❌ [分页加载异常]', error);
      showToast('分页加载出现异常', 'error');
    }

    return allChapters;
  }

  async function downloadMenu() {
    modal.style.display = 'flex';

    // 使用策略模式检测站点结构
    currentSiteSelector = detectSiteStructure();
    tocDiv = document.querySelector(currentSiteSelector.toc);
    
    if (!tocDiv) {
      alert('未能识别站点结构，请联系开发者添加支持');
      return;
    }

    // 检测是否需要分页加载
    const needsPagination = detectPaginationNeeded(currentSiteSelector);

    if (needsPagination) {
      console.log('📖 [分页模式] 检测到分页，开始加载所有分页...');
      showToast('检测到分页，正在加载所有章节...', 'info');

      // 异步加载所有分页的章节
      chapters = await loadPaginatedChapters(currentSiteSelector, tocDiv);

      if (!chapters.length) {
        alert('未找到章节列表，请检查页面结构');
        return;
      }

      console.log(`✅ [分页完成] 共获取 ${chapters.length} 个章节`);
    } else {
      console.log('📖 [单页模式] 无分页，使用单页加载');
      // 单页模式：获取章节列表（支持备用选择器，智能过滤"最新章节"区域）
      if (currentSiteSelector.chaptersAlt && tocDiv.querySelector('dl center.clear')) {
        chapters = document.querySelectorAll(currentSiteSelector.chaptersAlt);
      } else {
        // 智能检测：查找"正文"/"全部章节"区域，跳过"最新章节"区域
        // biquge.net 等站点有"最新章节"和"正文"两个区域，需要过滤
        const sectionTitles = document.querySelectorAll('h2.layout-tit, h2');
        let mainSectionBox = null;

        for (let i = 0; i < sectionTitles.length; i++) {
          const titleText = sectionTitles[i].innerText || '';
          // 跳过"最新章节"区域
          if (titleText.includes('最新章节') && !titleText.includes('正文')) {
            continue;
          }
          // 找到包含"正文"/"全部章节"/"目录"的区域
          if (titleText.includes('正文') || titleText.includes('全部章节') || titleText.includes('目录')) {
            // 获取该标题后面的第一个 div.section-box
            let nextElement = sectionTitles[i].nextElementSibling;
            while (nextElement) {
              if (nextElement.classList && nextElement.classList.contains('section-box')) {
                mainSectionBox = nextElement;
                break;
              }
              nextElement = nextElement.nextElementSibling;
            }
            if (mainSectionBox) break;
          }
        }

        // 如果找到了主区域，只从该区域提取章节
        if (mainSectionBox) {
          // 提取选择器中的最终标签名（如 'a[href]'）
          const chapterSelector = currentSiteSelector.chapters.split(' ').pop() || 'a[href]';
          chapters = mainSectionBox.querySelectorAll(chapterSelector);
        } else {
          // 降级：使用原来的选择器
          chapters = document.querySelectorAll(currentSiteSelector.chapters);
        }
      }

      if (!chapters.length) {
        alert('未找到章节列表，请检查页面结构');
        return;
      }

      // 章节去重：基于 href 去重，保留第一次出现的顺序
      const seenUrls = new Set();
      const uniqueChapters = [];
      for (const chapter of chapters) {
        const href = chapter.getAttribute('href');
        if (href && !seenUrls.has(href)) {
          seenUrls.add(href);
          uniqueChapters.push(chapter);
        }
      }
      chapters = uniqueChapters;
    }

    startRangeInput.max = chapters.length;
    finalRangeInput.max = chapters.length;

    startIndex = 0;
    finalIndex = chapters.length - 1;

    finalRangeInput.value = chapters.length;
    startTitle.innerText = chapters[startIndex].innerText;
    finalTitle.innerText = chapters[finalIndex].innerText;

    // 获取标题选项并填充下拉框
    const titleOptions = collectTitleOptions();
    titleSelect.innerHTML = '<option value="">自动检测（推荐）</option>';
    titleOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.label = opt.label;
      option.textContent = opt.label;
      option.dataset.text = opt.text;
      titleSelect.appendChild(option);
    });

    // 读取用户在当前域名保存的标题选择
    const domain = window.location.hostname;
    const savedTitlePreference = localStorage.getItem(`bqg_title_prefer_${domain}`);
    console.log(`📚 [标题偏好] 域名: ${domain}, 保存的选择: ${savedTitlePreference || '无'}`);

    // 恢复用户之前的选择
    if (savedTitlePreference === 'custom') {
      // 恢复自定义标题
      const savedCustomTitle = localStorage.getItem(`bqg_title_custom_${domain}`);
      if (savedCustomTitle) {
        titleCustom.value = savedCustomTitle;
        booktitle = savedCustomTitle;
        console.log(`✅ [标题恢复] 使用自定义标题: ${booktitle}`);
      } else {
        booktitle = document.title;
      }
    } else if (savedTitlePreference) {
      // 检查保存的值是否在下拉框中存在
      const savedOption = Array.from(titleSelect.options).find(opt => opt.value === savedTitlePreference);
      if (savedOption) {
        titleSelect.value = savedTitlePreference;
        booktitle = savedOption.dataset.text;
        console.log(`✅ [标题恢复] 使用保存的选择: ${booktitle}`);
      } else {
        // 保存的选项不存在，尝试下载按钮位置的 h1 或站点配置
        const firstOption = titleSelect.querySelector('option[value="download_btn_h1"]') ||
                           titleSelect.querySelector('option[value="site_selector"]');
        if (firstOption) {
          titleSelect.value = firstOption.value;
          booktitle = firstOption.dataset.text;
        } else {
          booktitle = document.title;
        }
      }
    } else {
      // 没有保存的选择，默认选择下载按钮位置的 h1 或站点配置
      const defaultOption = titleSelect.querySelector('option[value="download_btn_h1"]') ||
                           titleSelect.querySelector('option[value="site_selector"]');
      if (defaultOption) {
        titleSelect.value = defaultOption.value;
        booktitle = defaultOption.dataset.text;
      } else {
        booktitle = document.title;
      }
    }
    bookInfo.innerText=`当前小说:《${booktitle}》，共 ${chapters.length} 章。`

    // 检查断点续传（如果未禁用）
    if (!CONFIG.disableResume) {
      const savedProgress = localStorage.getItem(`bqg_progress_${booktitle}`);
      if (savedProgress) {
        try {
          const progress = JSON.parse(savedProgress);
          if (progress.totalChapters === chapters.length) {
            const resumeMsg = `检测到未完成的下载：\n章节范围: ${progress.startIndex + 1}-${progress.finalIndex + 1}\n已完成: ${progress.completedCount}/${progress.totalLinks}\n\n是否继续？`;
            if (confirm(resumeMsg)) {
              startIndex = progress.startIndex;
              finalIndex = progress.finalIndex;
              startRangeInput.value = startIndex + 1;
              finalRangeInput.value = finalIndex + 1;
              startTitle.innerText = chapters[startIndex].innerText;
              finalTitle.innerText = chapters[finalIndex].innerText;
              warnInfo.innerText = `将从第 ${progress.completedCount + 1} 章继续下载。点击开始下载继续。`;
              return;
            } else {
              localStorage.removeItem(`bqg_progress_${booktitle}`);
            }
          }
        } catch (e) {
          console.error('读取进度失败:', e);
        }
      }
    }
    
    warnInfo.innerText=`设置范围后点击开始下载，并稍作等待。\n若章节过多下载卡住，可尝试减小章节范围分次下载。`

    if(document.querySelector('button#downloadMenuBtn')) { document.querySelector('button#downloadMenuBtn').hidden=true; }
  }

  // 添加下载按钮函数（支持重复调用）
  function addDownloadButton() {
    const h1 = document.querySelector("h1");
    if (!h1) return false;
    
    // 防止重复添加
    if (document.querySelector('button#downloadMenuBtn')) return true;
    
    let downloadMenuBtn = document.createElement("button");
    downloadMenuBtn.innerText = "下载"
    downloadMenuBtn.id="downloadMenuBtn"
    downloadMenuBtn.style="padding:2px 10px; margin:auto 10px; font-size:15px; background:#ccF8;"
    h1.append(downloadMenuBtn)
    downloadMenuBtn.addEventListener('click', downloadMenu);
    return true;
  }

  // 初始化添加按钮
  addDownloadButton();

  // 标题选择事件监听
  titleSelect.addEventListener('change', () => {
    // 如果选择了一个选项，清空自定义输入
    if (titleSelect.value) {
      titleCustom.value = '';
      // 保存用户选择到 localStorage（按域名）
      const domain = window.location.hostname;
      localStorage.setItem(`bqg_title_prefer_${domain}`, titleSelect.value);
      console.log(`💾 [标题偏好保存] 域名: ${domain}, 选择: ${titleSelect.value}`);
    }
    updateTitleDisplay();
  });

  // 自定义标题输入事件监听
  titleCustom.addEventListener('input', () => {
    const customText = titleCustom.value.trim();
    // 如果输入了自定义标题，清空下拉选择
    if (customText) {
      titleSelect.value = '';
      // 保存自定义标题标记和内容到 localStorage（按域名）
      const domain = window.location.hostname;
      localStorage.setItem(`bqg_title_prefer_${domain}`, 'custom');
      localStorage.setItem(`bqg_title_custom_${domain}`, customText);
      console.log(`💾 [标题偏好保存] 域名: ${domain}, 选择: custom（自定义: ${customText}）`);
    }
    updateTitleDisplay();
  });

  // MutationObserver 监听 DOM 变化，处理异步渲染导致的按钮丢失
  const observer = new MutationObserver((mutations) => {
    // 检查按钮是否还在，如果丢失则重新添加
    if (document.querySelector("h1") && !document.querySelector('button#downloadMenuBtn')) {
      console.log('[笔趣阁下载器] 检测到按钮丢失，重新挂载');
      addDownloadButton();
    }
  });

  // 监听整个 body 的子树变化
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  GM_registerMenuCommand('小说下载工具', downloadMenu);
  GM_registerMenuCommand('⚙️ 下载设置', () => {
    openedFromMenu = true;
    document.getElementById('config_concurrency').value = CONFIG.concurrency;
    document.getElementById('config_retries').value = CONFIG.maxRetries;
    document.getElementById('config_timeout').value = CONFIG.timeout;
    document.getElementById('config_minlength').value = CONFIG.minContentLength;
    document.getElementById('config_throttle_min').value = CONFIG.throttleMin;
    document.getElementById('config_throttle_max').value = CONFIG.throttleMax;
    document.getElementById('config_disable_resume').checked = CONFIG.disableResume;
    console.log('⚙️ [打开配置] 从菜单打开，设置 checkbox =', CONFIG.disableResume);
    configModal.style.display = 'flex';
  });

  // === 预览功能 ===
  async function showPreview() {
    if (!chapters || chapters.length === 0) {
      alert('请先打开下载窗口');
      return;
    }
    
    // 随机抽取章节
    const previewCount = Math.min(CONFIG.previewCount, chapters.length);
    const indices = [];
    while (indices.length < previewCount) {
      const idx = Math.floor(Math.random() * chapters.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    
    previewContent.innerHTML = '<div style="text-align:center; color:#999;">加载中...</div>';
    previewModal.style.display = 'flex';
    
    try {
      const previews = await Promise.all(indices.map(async (idx) => {
        const link = chapters[idx];
        const url = link.href;
        const title = link.textContent.trim();
        
        // 简单获取内容（使用 GM_xmlhttpRequest 绕过 CORS）
        try {
          const response = await gmFetch(url);
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          
          // 尝试所有content选择器（currentSiteSelector.content是数组）
          let contentEl = null;
          for (const selector of currentSiteSelector.content) {
            contentEl = doc.querySelector(selector);
            if (contentEl && contentEl.innerText.trim().length > 10) break;
          }
          
          let content = contentEl ? cleanContent(contentEl.innerText) : '';
          
          // 内容检测：过短则尝试 iframe 方式（处理异步加载）
          if (content.length < CONFIG.minContentLength) {
            console.log(`[预览] 内容过短(${content.length}字)，尝试 iframe 加载: ${title}`);
            try {
              const iframeResult = await fetchContentWithIframe(url, currentSiteSelector.content);
              content = iframeResult.content;
            } catch (iframeError) {
              console.warn(`[预览] iframe 加载失败: ${iframeError.message}`);
              content = content || '无法获取内容（可能需要异步加载）';
            }
          }
          
          // 如果还是没内容，显示提示
          if (!content || content.length < 10) {
            content = '无法获取内容（页面可能需要登录或异步加载）';
          }
          
          // 截取前200字
          if (content.length > 200) content = content.substring(0, 200) + '...';
          
          return `<div style="margin-bottom:20px; padding:12px; background:#f9f9f9; border-radius:8px;">
            <div style="font-weight:600; color:#667eea; margin-bottom:8px;">第${idx + 1}章: ${title}</div>
            <div style="color:#666; line-height:1.8;">${content}</div>
          </div>`;
        } catch (e) {
          return `<div style="margin-bottom:20px; padding:12px; background:#ffebee; border-radius:8px;">
            <div style="font-weight:600; color:#f44336; margin-bottom:8px;">第${idx + 1}章: ${title}</div>
            <div style="color:#999;">预览失败: ${e.message}</div>
          </div>`;
        }
      }));
      
      previewContent.innerHTML = `<div style="font-size:12px; color:#999; margin-bottom:15px;">随机抽取 ${previewCount} 章进行预览</div>` + previews.join('');
    } catch (e) {
      previewContent.innerHTML = `<div style="text-align:center; color:#f44336;">预览失败: ${e.message}</div>`;
    }
  }
  
  previewButton.addEventListener('click', showPreview);
  previewModalClose.addEventListener('click', () => previewModal.style.display = 'none');
  skipPreviewButton.addEventListener('click', () => {
    CONFIG.enablePreview = false;
    previewModal.style.display = 'none';
    showToast('已关闭预览功能', 'info');
  });
  continueDownloadButton.addEventListener('click', () => previewModal.style.display = 'none');

  // === 规则分析功能 ===
  // 分析章节规则
  analyzeTocButton.addEventListener('click', () => {
    analyzerModalTitle.innerText = '📊 章节规则分析';
    analyzerModalTitle.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    analyzerContent.innerHTML = '<div style="text-align:center; color:#999;">正在分析目录页结构...</div>';
    ruleAnalyzerModal.style.display = 'flex';
    
    // 异步分析（避免阻塞UI）
    setTimeout(() => {
      try {
        const analyzedRule = RuleAnalyzer.analyzeTocPage();
        analyzerContent.innerHTML = RuleAnalyzer.generateReport(analyzedRule);
      } catch (e) {
        analyzerContent.innerHTML = `<div style="text-align:center; color:#f44336;">分析失败: ${e.message}</div>`;
      }
    }, 100);
  });
  
  // 分析内容规则
  analyzeContentButton.addEventListener('click', () => {
    analyzerModalTitle.innerText = '🔧 内容规则分析';
    analyzerModalTitle.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    analyzerContent.innerHTML = '<div style="text-align:center; color:#999;">正在分析内容页结构...</div>';
    ruleAnalyzerModal.style.display = 'flex';
    
    // 异步分析（避免阻塞UI）
    setTimeout(() => {
      try {
        const analyzedRule = RuleAnalyzer.analyzeContentPage();
        analyzerContent.innerHTML = RuleAnalyzer.generateReport(analyzedRule);
      } catch (e) {
        analyzerContent.innerHTML = `<div style="text-align:center; color:#f44336;">分析失败: ${e.message}</div>`;
      }
    }, 100);
  });
  
  analyzerModalClose.addEventListener('click', () => ruleAnalyzerModal.style.display = 'none');
  closeAnalyzerButton.addEventListener('click', () => ruleAnalyzerModal.style.display = 'none');

  // === 手动标记功能 ===
  pickTocButton.addEventListener('click', () => {
    // 关闭主 modal，进入标记模式
    modal.style.display = 'none';
    ElementPicker.start('toc', async () => {
      // 完成后重新打开主 modal
      modal.style.display = 'flex';
      showToast('✅ 目录页规则已保存，正在刷新章节列表...', 'success', 3000);

      // 刷新章节列表
      const success = await refreshChapters();
      if (!success) {
        showToast('⚠️ 章节列表刷新失败，请检查选择器是否正确', 'warn', 4000);
      }
    });
  });

  pickContentButton.addEventListener('click', () => {
    modal.style.display = 'none';
    ElementPicker.start('content', (rule) => {
      modal.style.display = 'flex';
      showToast('✅ 内容页规则已保存，下载章节时将自动使用新规则', 'success', 3000);
    });
  });

  applyRuleButton.addEventListener('click', () => {
    const rule = RuleAnalyzer.getEditedRule();
    
    // 根据类型验证不同字段
    if (RuleAnalyzer.currentType === 'toc') {
      if (!rule.name || !rule.toc || !rule.chapters || rule.content.length === 0 || !rule.title) {
        alert('请填写所有必需字段（站点名称、目录容器、章节链接、内容选择器、标题选择器）');
        return;
      }
    } else {
      if (!rule.name || rule.content.length === 0) {
        alert('请填写所有必需字段（站点名称、内容选择器）');
        return;
      }
    }
    
    // 添加到自定义站点规则
    if (SiteRuleManager.addRule(rule)) {
      // 如果内容规则分析检测到清洗pattern，同步写入 CleanRuleManager
      if (RuleAnalyzer.currentType === 'content' && rule.cleanPatterns && rule.cleanPatterns.length > 0) {
        rule.cleanPatterns.forEach((pattern, i) => {
          CleanRuleManager.addRule({
            name: `${rule.name} - 清洗规则${i + 1}`,
            pattern: pattern,
            flags: 'gi'
          });
        });
        // 重新加载清洗规则到内存
        CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
        showToast(`✅ 规则"${rule.name}"已添加，同时写入 ${rule.cleanPatterns.length} 条清洗规则\n刷新页面后生效`);
      } else {
        showToast(`✅ 规则"${rule.name}"已添加\n刷新页面后生效`);
      }
      ruleAnalyzerModal.style.display = 'none';
      
      // 更新规则列表（如果规则管理窗口已打开）
      if (ruleModal.style.display !== 'none') {
        renderRulesList();
      }
    } else {
      showToast('应用规则失败，请打开控制台查看错误信息（F12）', 'error');
    }
  });
  
  exportAnalyzedRuleButton.addEventListener('click', () => {
    const rule = RuleAnalyzer.getEditedRule();
    
    // 验证必需字段
    if (!rule.name || !rule.toc || !rule.chapters || rule.content.length === 0 || !rule.title) {
      alert('请填写所有必需字段后再导出');
      return;
    }
    
    // 生成JSON文件
    const json = JSON.stringify([rule], null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bqg_rule_${rule.name}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('✅ 规则已导出');
  });

  // === 规则管理功能 ===
  function renderRulesList() {
    const allRules = SiteRuleManager.getAllRules();
    const html = allRules.map(rule => `
      <div style="margin-bottom:12px; padding:12px; background:#f9f9f9; border-radius:8px; ${rule.custom ? 'border-left:3px solid #66bb6a;' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1;">
            <div style="font-weight:600; color:#333; margin-bottom:4px;">${rule.name}${rule.custom ? ' <span style="font-size:10px; color:#66bb6a;">[自定义]</span>' : ' <span style="font-size:10px; color:#999;">[内置]</span>'}</div>
            <div style="font-size:11px; color:#999;">目录: ${rule.toc} | 标题: ${rule.title}</div>
          </div>
          ${rule.custom ? `<button onclick="deleteRule('${rule.id}')" style="background:#f44336; color:white; padding:6px 12px; border-radius:4px; font-size:11px;">删除</button>` : ''}
        </div>
      </div>
    `).join('');
    
    rulesList.innerHTML = html || '<div style="text-align:center; color:#999; padding:20px;">暂无规则</div>';
  }
  
  window.deleteRule = function(id) {
    if (confirm('确定删除此规则？')) {
      if (SiteRuleManager.deleteRule(id)) {
        renderRulesList();
        showToast('✅ 删除成功');
      } else {
        showToast('删除失败', 'error');
      }
    }
  };
  
  ruleManageButton.addEventListener('click', () => {
    renderRulesList();
    ruleModal.style.display = 'block';
  });
  
  ruleModalClose.addEventListener('click', () => ruleModal.style.display = 'none');
  
  addRuleButton.addEventListener('click', () => {
    const name = prompt('规则名称（如：某某小说网）:');
    if (!name) return;
    
    const toc = prompt('目录选择器（CSS Selector）:');
    if (!toc) return;
    
    const chapters = prompt('章节选择器（CSS Selector）:');
    if (!chapters) return;
    
    const content = prompt('内容选择器（CSS Selector）:');
    if (!content) return;
    
    const title = prompt('标题选择器（CSS Selector）:');
    if (!title) return;
    
    if (SiteRuleManager.addRule({ name, toc, chapters, content, title })) {
      renderRulesList();
      showToast('✅ 添加成功');
    } else {
      showToast('添加失败', 'error');
    }
  });
  
  exportRulesButton.addEventListener('click', () => {
    SiteRuleManager.exportRules();
  });
  
  importRulesButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        if (SiteRuleManager.importRules(event.target.result)) {
          renderRulesList();
          showToast('✅ 导入成功');
        } else {
          showToast('导入失败，请检查文件格式', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  // 配置按钮事件
  configBtn.addEventListener('click', () => {
    openedFromMenu = false;
    document.getElementById('config_concurrency').value = CONFIG.concurrency;
    document.getElementById('config_retries').value = CONFIG.maxRetries;
    document.getElementById('config_timeout').value = CONFIG.timeout;
    document.getElementById('config_minlength').value = CONFIG.minContentLength;
    document.getElementById('config_throttle_min').value = CONFIG.throttleMin;
    document.getElementById('config_throttle_max').value = CONFIG.throttleMax;
    document.getElementById('config_disable_resume').checked = CONFIG.disableResume;
    console.log('⚙️ [打开配置] 从下载窗口打开，设置 checkbox =', CONFIG.disableResume);
    configModal.style.display = 'flex';
    modal.style.display = 'none';
  });

  // 保存配置
  saveConfigButton.addEventListener('click', () => {
    // 校验输入值
    const concurrency = Math.max(1, Math.min(20, parseInt(document.getElementById('config_concurrency').value) || 8));
    const maxRetries = Math.max(0, Math.min(10, parseInt(document.getElementById('config_retries').value) || 3));
    const timeout = Math.max(5, Math.min(60, parseInt(document.getElementById('config_timeout').value) || 10));
    const minContentLength = Math.max(10, Math.min(200, parseInt(document.getElementById('config_minlength').value) || 50));
    let throttleMin = Math.max(1, Math.min(20, parseInt(document.getElementById('config_throttle_min').value) || 3));
    let throttleMax = Math.max(1, Math.min(30, parseInt(document.getElementById('config_throttle_max').value) || 15));
    
    // 确保下限不大于上限
    if (throttleMin > throttleMax) {
      const temp = throttleMin;
      throttleMin = throttleMax;
      throttleMax = temp;
    }
    
    CONFIG.concurrency = concurrency;
    CONFIG.maxRetries = maxRetries;
    CONFIG.timeout = timeout;
    CONFIG.minContentLength = minContentLength;
    CONFIG.throttleMin = throttleMin;
    CONFIG.throttleMax = throttleMax;
    CONFIG.disableResume = document.getElementById('config_disable_resume').checked;

    console.log('💾 [保存配置]');
    console.log(`   禁用断点续传: ${CONFIG.disableResume} (checkbox: ${document.getElementById('config_disable_resume').checked})`);

    localStorage.setItem('bqg_concurrency', CONFIG.concurrency);
    localStorage.setItem('bqg_maxRetries', CONFIG.maxRetries);
    localStorage.setItem('bqg_timeout', CONFIG.timeout);
    localStorage.setItem('bqg_minContentLength', CONFIG.minContentLength);
    localStorage.setItem('bqg_throttleMin', CONFIG.throttleMin);
    localStorage.setItem('bqg_throttleMax', CONFIG.throttleMax);
    localStorage.setItem('bqg_disableResume', CONFIG.disableResume ? 'true' : 'false');

    console.log(`   已写入 localStorage: bqg_disableResume = "${localStorage.getItem('bqg_disableResume')}"`);

    // 验证读取
    const verifyRead = localStorage.getItem('bqg_disableResume') === 'true';
    console.log(`   验证读取: ${verifyRead}`);

    // 更新输入框显示（防止用户输入超出范围）
    document.getElementById('config_concurrency').value = concurrency;
    document.getElementById('config_retries').value = maxRetries;
    document.getElementById('config_timeout').value = timeout;
    document.getElementById('config_minlength').value = minContentLength;
    document.getElementById('config_throttle_min').value = throttleMin;
    document.getElementById('config_throttle_max').value = throttleMax;
    document.getElementById('config_disable_resume').checked = CONFIG.disableResume;

    showToast(`✅ 设置已保存  断点续传: ${CONFIG.disableResume ? '已禁用' : '已启用'}`);
    configModal.style.display = 'none';
    
    // 如果不是从菜单打开的，返回主界面
    if (!openedFromMenu) {
      modal.style.display = 'flex';
    }
    openedFromMenu = false; // 重置标记
  });

  // 配置弹窗关闭
  configModalClose.addEventListener('click', () => {
    configModal.style.display = 'none';
    // 如果不是从菜单打开的，返回主界面
    if (!openedFromMenu) {
      modal.style.display = 'flex';
    }
    openedFromMenu = false; // 重置标记
  });

  // === 缓存清除功能 ===

  // 缓存类型定义
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

  // 清除指定类型的缓存
  function clearCacheByType(type) {
    const cacheType = CACHE_TYPES[type];
    if (!cacheType) {
      alert('❌ 未知的缓存类型');
      return;
    }

    const keysToRemove = [];

    if (cacheType.keys) {
      // 使用指定的键列表
      cacheType.keys.forEach(key => {
        if (localStorage.getItem(key)) {
          keysToRemove.push(key);
        }
      });
    } else {
      // 使用正则匹配
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

    if (!confirm(`确定要清除${cacheType.name}吗？\n\n${cacheType.description}\n\n将清除 ${keysToRemove.length} 项数据：\n${keysToRemove.map(k => `• ${k}`).join('\n')}\n\n此操作不可撤销！`)) {
      return;
    }

    try {
      console.log('🗑️ [清除缓存] 开始清除...');
      console.log(`   类型: ${cacheType.name}`);
      console.log(`   将清除:`, keysToRemove);

      keysToRemove.forEach(key => localStorage.removeItem(key));

      console.log(`✅ [清除完成] 已清除 ${keysToRemove.length} 项数据`);
      showToast(`✅ ${cacheType.name}已清除，共 ${keysToRemove.length} 项`);

      if (cacheType.needReload) {
        console.log('🔄 [页面刷新] 配置已更改，重新加载页面...');
        location.reload();
      }
    } catch (e) {
      console.error('❌ [清除失败]', e);
      showToast(`清除失败：${e.message}`, 'error');
    }
  }

  // 绑定分类清除按钮事件
  document.querySelectorAll('.cache-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      clearCacheByType(type);
    });
  });

  // 清除所有缓存按钮
  const clearAllCacheButton = document.getElementById('clearAllCacheButton');
  if (clearAllCacheButton) {
    clearAllCacheButton.addEventListener('click', () => clearCacheByType('all'));
  }

  // === 内容清洗规则管理功能 ===
  
  // 渲染清洗规则列表
  function renderCleanRulesList() {
    const rules = CleanRuleManager.getAllRulesWithStatus();
    
    if (rules.length === 0) {
      cleanRulesList.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">暂无清洗规则</div>';
      return;
    }
    
    const html = rules.map(rule => `
      <div style="margin-bottom:12px; padding:12px; background:#f9f9f9; border-radius:8px; border-left:4px solid ${rule.enabled ? '#4caf50' : '#ccc'};">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div style="flex:1;">
            <div style="font-weight:600; color:#333; margin-bottom:4px; display:flex; align-items:center; gap:8px;">
              <label style="display:flex; align-items:center; cursor:pointer;">
                <input type="checkbox" ${rule.enabled ? 'checked' : ''}
                  onchange="toggleCleanRule('${rule.id}', this.checked)"
                  style="margin-right:6px;">
                <span>${rule.name}</span>
              </label>
              ${rule.builtin ? '<span style="padding:2px 6px; background:#2196f3; color:white; border-radius:4px; font-size:10px;">内置</span>' : '<span style="padding:2px 6px; background:#ff9800; color:white; border-radius:4px; font-size:10px;">自定义</span>'}
            </div>
            <div style="font-family:monospace; font-size:11px; color:#666; background:white; padding:6px; border-radius:4px; word-break:break-all;">
              /${rule.pattern}/${rule.flags}
            </div>
          </div>
          <div style="display:flex; gap:6px; margin-left:12px;">
            ${!rule.builtin ? `
              <button onclick="editCleanRule('${rule.id}')" style="padding:4px 10px; background:#4fc3f7; color:white; border-radius:4px; font-size:11px; cursor:pointer;">✏️ 编辑</button>
              <button onclick="deleteCleanRule('${rule.id}')" style="padding:4px 10px; background:#e53935; color:white; border-radius:4px; font-size:11px; cursor:pointer;">🗑️ 删除</button>
            ` : ''}
          </div>
        </div>
      </div>
    `).join('');
    
    cleanRulesList.innerHTML = html;
  }
  
  // 切换规则启用状态（全局函数）
  window.toggleCleanRule = function(id, enabled) {
    CleanRuleManager.toggleRule(id, enabled);
    // 重新加载清洗规则
    CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
    renderCleanRulesList();
  };
  
  // 编辑规则（全局函数）
  window.editCleanRule = function(id) {
    const rules = CleanRuleManager.getCustomRules();
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    
    const name = prompt('规则名称：', rule.name);
    if (!name) return;
    
    const pattern = prompt('正则表达式（不含斜杠和标志）：', rule.pattern);
    if (!pattern) return;
    
    const flags = prompt('正则标志（如：gi, g, i）：', rule.flags);
    if (flags === null) return;
    
    // 测试正则表达式是否有效
    try {
      new RegExp(pattern, flags);
    } catch (e) {
      alert(`正则表达式格式错误：${e.message}`);
      return;
    }
    
    CleanRuleManager.updateRule(id, { name, pattern, flags });
    // 重新加载清洗规则
    CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
    renderCleanRulesList();
    showToast('✅ 规则已更新');
  };
  
  // 删除规则（全局函数）
  window.deleteCleanRule = function(id) {
    if (!confirm('确定要删除这条规则吗？')) return;
    
    CleanRuleManager.deleteRule(id);
    // 重新加载清洗规则
    CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
    renderCleanRulesList();
    showToast('✅ 规则已删除');
  };
  
  // 打开清洗规则管理弹窗
  manageCleanRulesButton.addEventListener('click', () => {
    renderCleanRulesList();
    cleanRuleModal.style.display = 'block';
    configModal.style.display = 'none';
  });
  
  // 关闭清洗规则弹窗
  cleanRuleModalClose.addEventListener('click', () => {
    cleanRuleModal.style.display = 'none';
    configModal.style.display = 'block';
  });
  
  // 添加清洗规则
  addCleanRuleButton.addEventListener('click', () => {
    const name = prompt('请输入规则名称：');
    if (!name) return;
    
    const pattern = prompt('请输入正则表达式（不含斜杠和标志）：\n\n示例：\n- 匹配网址：https?:\\\\/\\\\/[^\\\\s]+\n- 匹配域名：[a-z0-9]+[\\\\s·点][a-z]{2,}');
    if (!pattern) return;
    
    const flags = prompt('请输入正则标志（如：gi, g, i）：', 'g');
    if (flags === null) return;
    
    // 测试正则表达式是否有效
    try {
      new RegExp(pattern, flags);
    } catch (e) {
      alert(`正则表达式格式错误：${e.message}`);
      return;
    }
    
    CleanRuleManager.addRule({ name, pattern, flags });
    // 重新加载清洗规则
    CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
    renderCleanRulesList();
    showToast('✅ 清洗规则已添加');
  });
  
  // 导入清洗规则
  importCleanRulesButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (CleanRuleManager.importRules(evt.target.result)) {
          // 重新加载清洗规则
          CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
          renderCleanRulesList();
          showToast('✅ 导入成功');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
  
  // 导出清洗规则
  exportCleanRulesButton.addEventListener('click', () => {
    const rules = CleanRuleManager.getCustomRules();
    if (rules.length === 0) {
      showToast('暂无自定义规则可导出', 'info');
      return;
    }
    CleanRuleManager.exportRules();
  });
  
  // 重置清洗规则
  resetCleanRulesButton.addEventListener('click', () => {
    if (!confirm('确定要重置为默认规则吗？这将清除所有自定义规则和禁用设置。')) return;
    
    CleanRuleManager.resetToDefault();
    // 重新加载清洗规则
    CONTENT_CLEAN_PATTERNS = CleanRuleManager.getEnabledPatterns();
    renderCleanRulesList();
    showToast('✅ 已重置为默认规则');
  });

  fetcClose.addEventListener('click', async () => {
    modal.style.display = 'none';
    if(document.querySelector('button#downloadMenuBtn')) { document.querySelector('button#downloadMenuBtn').hidden=false; }
  });

  startRangeInput.addEventListener('input', function() {
    let val = parseInt(startRangeInput.value)
    if (!isNaN(val)) {
      if (val < 1) {val = 1;}
      if (val > chapters.length) {val = chapters.length;}
      startRangeInput.value = val;
      startIndex = parseInt(val) - 1;
      startTitle.innerText = chapters[startIndex].innerText;
    }
  });

  finalRangeInput.addEventListener('input', function() {
    let val = parseInt(finalRangeInput.value)
    if (!isNaN(val)) {
      if (val < 1) {val = 1;}
      if (val > chapters.length) {val = chapters.length;}
      finalRangeInput.value = val;
      finalIndex = parseInt(val) - 1;
      finalTitle.innerText = chapters[finalIndex].innerText;
    }
  });

  // 重试失败章节按钮事件
  retryFailedButton.addEventListener('click', async () => {
    if (failedChapters.length === 0) return;

    retryFailedButton.disabled = true;
    retryFailedButton.innerText = '重试中...';

    // 保存当前进度条状态（百分比、宽度、颜色样式）
    const savedProgressText = progressBar.textContent;
    const savedProgressWidth = progressBar.style.width;
    const savedProgressClasses = progressBar.className;

    // 重试时清除警告和错误样式，但保持其他状态
    progressBar.classList.remove('progress-warning', 'progress-error');

    const retryTasks = failedChapters.map(failed => {
      const chapterIndex = failed.index - startIndex - 1; // 转换为相对索引
      return {
        link: selectedLinks[chapterIndex],
        index: chapterIndex,
        originalIndex: failed.index
      };
    });

    let retryCompleted = 0;
    const retryTotal = retryTasks.length;
    const newFailures = [];

    // 重试失败章节
    for (const task of retryTasks) {
      try {
        const url = task.link.href;
        results[task.index] = await fetchContent(url, task.link);
        retryCompleted++;
        // 只显示重试进度，不影响主进度条百分比
        progressBar.textContent = `🔄 重试中: ${retryCompleted}/${retryTotal}`;
      } catch (error) {
        newFailures.push({
          index: task.originalIndex,
          title: task.link.innerText,
          error: error.message
        });
      }
    }

    // 更新失败列表
    failedChapters = newFailures;

    if (failedChapters.length === 0) {
      failedChaptersInfo.style.display = 'none';
      showToast('✅ 所有失败章节重试成功');
    } else {
      failedChaptersList.innerHTML = failedChapters.map(f =>
        `<div style="margin:3px 0;">第${f.index}章: ${f.title}<br><span style="font-size:11px; color:#666;">错误: ${f.error}</span></div>`
      ).join('');
      showToast(`重试完成：${retryCompleted - failedChapters.length}/${retryTotal} 章成功，${failedChapters.length} 章仍然失败`, 'warn', 4000);
    }

    // 重新生成下载文件（使用公共函数）
    generateDownloadFile();

    // 恢复进度条原始状态（不影响主下载进度显示）
    progressBar.textContent = savedProgressText;
    progressBar.style.width = savedProgressWidth;
    // 如果之前有警告或错误样式，且现在还有失败章节，则恢复样式
    if (failedChapters.length > 0 && (savedProgressClasses.includes('progress-warning') || savedProgressClasses.includes('progress-error'))) {
      progressBar.className = savedProgressClasses;
    } else if (failedChapters.length === 0) {
      // 全部成功，清除警告和错误样式
      progressBar.classList.remove('progress-warning', 'progress-error');
    }

    retryFailedButton.disabled = false;
    retryFailedButton.innerText = '重试失败章节';
  });

  // 生成下载文件（内存优化：提取公共逻辑，使用Blob分块构建）
  function generateDownloadFile() {
    const bookInfoDiv = document.querySelector(currentSiteSelector.bookInfo);
    
    // 使用数组收集内容块，最后一次性join（O(n)性能）
    // 注：当前实现已相对优化，真正的流式写入会显著增加复杂度
    // 对于典型场景（几百章，每章几KB），当前方案已足够高效
    const parts = [];
    parts.push(bookInfoDiv ? bookInfoDiv.innerText : booktitle);
    parts.push(`\n\n下载章节索引范围：${startIndex+1} ~ ${finalIndex+1}\n`);
    parts.push(`\n来自链接：${document.URL}\n`);
    parts.push("\n-----------------------\n");
    
    // 遍历章节内容
    results.forEach((result) => {
      parts.push(`\n## ${result.title}\n\n`);
      parts.push(result.content + '\n');
    });
    
    parts.push("\n-----------------------\n");
    
    // 一次性创建Blob（而非多次拼接字符串）
    const blob = new Blob([parts.join('')], { type: 'text/plain' });
    downlink.href = URL.createObjectURL(blob);
    downlink.download = `${booktitle}.txt`;
    downlink.click();
  }

  // 使用 iframe 加载页面（等待 JS 执行完成）
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
        iframe.src = 'about:blank'; // 停止所有网络请求
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      };
      
      // 超时保护
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('iframe 加载超时'));
      }, CONFIG.timeout * 1000);
      
      iframe.onload = () => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          
          // 轮询检测内容是否出现
          checkInterval = setInterval(() => {
            const contentDiv = iframeDoc.querySelector(contentSelector[0]) || 
                               iframeDoc.querySelector(contentSelector[1]) || 
                               iframeDoc.querySelector(contentSelector[2]);
            
            if (contentDiv && contentDiv.innerText.trim().length > CONFIG.minContentLength) {
              cleanup();
              
              // 清理广告
              contentDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
              contentDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());
              contentDiv.innerHTML = contentDiv.innerHTML.replaceAll('<br>', '\n');
              
              const title = iframeDoc.querySelector('h1')?.innerText || '';
              const content = cleanContent(contentDiv.innerText); // 使用内容清洗
              
              resolve({ title, content });
            }
          }, CONSTANTS.IFRAME_CHECK_INTERVAL);
          
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
      // 使用 GM_xmlhttpRequest 绕过 CORS 限制
      const response = await gmFetch(pageUrl);

      if (!response.ok) {
        const errorMsg = response.status === 404 ? '章节不存在(404)' :
                         response.status === 403 ? '访问被拒绝(403)' :
                         response.status === 503 ? '服务器现在无法处理请求(503)' :
                         response.status >= 500 ? `服务器错误(${response.status})` :
                         `HTTP 错误(${response.status})`;
        throw new Error(errorMsg);
      }

      let text = '';
      // GM_xmlhttpRequest 直接返回 text，不需要处理 encoding
      text = await response.text();

      // 检测是否被重定向到登录页面
      if (text.includes('login.php') || text.includes('登录') || text.includes('请先登录')) {
        throw new Error('需要登录才能查看此章节');
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      // 使用站点配置的内容选择器
      let contentDiv = null;
      for (const selector of currentSiteSelector.content) {
        contentDiv = doc.querySelector(selector);
        if (contentDiv) break;
      }

      // 降级：如果配置的选择器都找不到，尝试常见选择器
      if (!contentDiv) {
        contentDiv = doc.querySelector('div#content') || doc.querySelector('#chaptercontent') || doc.querySelector('.content');
      }

      if (contentDiv) {
        contentDiv.querySelectorAll('div#device').forEach(function(web_ad) {
          web_ad.remove();
        });
        contentDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(function(web_op) {
          web_op.remove();
        });
        contentDiv.innerHTML = contentDiv.innerHTML.replaceAll('<br>', '\n');
        const extractedContent = contentDiv.innerText.trim();
        const cleanedContent = cleanContent(extractedContent); // 使用内容清洗

        // 内容校验：如果内容太少，可能是异步加载未完成
        if (cleanedContent.length < CONFIG.minContentLength) {
          console.warn(`[异步加载检测] ${pageUrl} 内容过短，尝试使用 iframe 等待加载`);
          try {
            const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector.content);
            allContent += iframeResult.content + '\n\n';
            if (!title && iframeResult.title) {
              title = iframeResult.title;
            }
            return; // 成功获取，直接返回
          } catch (iframeError) {
            console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
            // 降级：使用原内容（即使很短）
            allContent += cleanedContent + '\n\n';
          }
        } else {
          allContent += cleanedContent + '\n\n';
        }
      } else {
        // 完全找不到内容元素，尝试 iframe
        console.warn(`[异步加载检测] ${pageUrl} 未找到内容元素，尝试使用 iframe`);
        try {
          const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector.content);
          allContent += iframeResult.content + '\n\n';
          if (!title && iframeResult.title) {
            title = iframeResult.title;
          }
        } catch (iframeError) {
          console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
          throw new Error('无法获取章节内容（元素不存在且 iframe 加载失败）');
        }
      }

      if (doc.querySelector('h1')) {
        title = doc.querySelector('h1').innerText;
      }

      const nextPage = doc.querySelector('.read-page a[href][rel="next"]');
      if (nextPage && (nextPage.innerText == '下一页')) {
        console.log(nextPage.href);
        const nextUrl = nextPage.href.startsWith('http') ? nextPage.href : new URL(nextPage.href, pageUrl).href;
        await fetchPage(nextUrl);
      }
    }

    await fetchPage(url);

    if (link && !title) {
      title = link.innerText;
    }

    return { title: title, content: allContent };
  }

  fetchButton.addEventListener('click', async () => {
    // 取消下载功能
    if (isDownloading) {
      if (confirm('确定要取消当前下载吗？进度将会保存。')) {
        abortController.abort();
        fetchButton.innerText = '开始下载';
        isDownloading = false;
      }
      return;
    }

    downlink.innerText = "";
    downlink.href = null;
    downlink.download = null;
    fetchButton.innerText = '取消下载';
    isDownloading = true;
    failedChapters = [];
    downloadStartTime = Date.now();
    
    // 隐藏检测结果（清空上次结果）
    detectionResultsContainer.style.display = 'none';
    
    // 启动进度条实时刷新（每200ms更新一次）
    progressBar.style.width = '0%';
    progressBar.textContent = '准备下载...';
    progressUpdateInterval = setInterval(updateProgressBar, 200);
    
    // AbortController 兼容性检查
    abortController = typeof AbortController !== 'undefined' 
      ? new AbortController() 
      : { signal: null, abort: () => console.warn('[兼容性] AbortController 不支持') };

    if (startIndex > finalIndex) {
      let temp0 = startIndex;
      let temp1 = finalIndex;
      startIndex = temp1;
      finalIndex = temp0;
      startRangeInput.value = startIndex+1;
      startTitle.innerText = chapters[startIndex].innerText;
      finalRangeInput.value = finalIndex+1;
      finalTitle.innerText = chapters[finalIndex].innerText;
    }

    // 使用已检测的章节列表，而不是硬编码选择器
    selectedLinks = Array.from(chapters).slice(startIndex, finalIndex+1);

    if (!booktitle){
      booktitle = document.title;
    }
    results = [];
    totalLinks = selectedLinks.length;
    completedRequests = 0;

    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 [开始下载] 参数信息：');
    console.log(`  书名: ${booktitle}`);
    // 显示标题来源
    if (titleCustom.value.trim()) {
      console.log(`  标题来源: 自定义输入`);
    } else if (titleSelect.value) {
      const option = titleSelect.options[titleSelect.selectedIndex];
      console.log(`  标题来源: ${option.text}`);
    } else {
      console.log(`  标题来源: 自动检测`);
    }
    console.log(`  章节范围: ${startIndex + 1} ~ ${finalIndex + 1}`);
    console.log(`  总章节数: ${totalLinks}`);
    console.log(`  断点续传: ${CONFIG.disableResume ? '已禁用' : '已启用'}`);
    console.log('═══════════════════════════════════════════════════════');

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // 检查是否有保存的进度（用于续传）
    let savedResults = [];
    if (!CONFIG.disableResume) {
      const progressKey = `bqg_progress_${booktitle}`;
      const savedProgress = localStorage.getItem(progressKey);
      console.log(`📦 [断点续传检查] 缓存键: ${progressKey}`);

      if (savedProgress) {
        console.log('✅ 找到缓存数据，解析中...');
        try {
          const progress = JSON.parse(savedProgress);
          console.log('📋 缓存内容:', {
            缓存范围: `${progress.startIndex + 1} ~ ${progress.finalIndex + 1}`,
            当前范围: `${startIndex + 1} ~ ${finalIndex + 1}`,
            已完成: `${progress.completedCount}/${progress.totalLinks}`,
            结果数组长度: progress.results ? progress.results.length : 0
          });

          if (progress.startIndex === startIndex && progress.finalIndex === finalIndex && progress.results) {
            savedResults = progress.results;
            completedRequests = progress.completedCount || 0;
            console.log(`🔄 [断点续传] 恢复 ${completedRequests} 个已下载章节，从第 ${completedRequests + 1} 章继续`);
          } else {
            console.log('⚠️ 缓存范围不匹配或无结果数据，将重新下载');
          }
        } catch (e) {
          console.error('❌ 解析保存的进度失败:', e);
        }
      } else {
        console.log('ℹ️ 未找到缓存数据，将全新下载');
      }
    } else {
      // 禁用续传时，清除旧进度缓存
      const oldProgress = localStorage.getItem(`bqg_progress_${booktitle}`);
      if (oldProgress) {
        localStorage.removeItem(`bqg_progress_${booktitle}`);
        console.log('🗑️ [断点续传已禁用] 已清除旧的进度缓存');
      } else {
        console.log('ℹ️ [断点续传已禁用] 无旧缓存需要清除');
      }
    }

    const fetchAndParse = async (link, index, retryCount = 0) => {
      // 如果已有保存的结果，直接跳过
      if (savedResults[index]) {
        console.log(`⏭️ [跳过章节#${index + 1}] ${link.innerText.trim()} (使用缓存)`);
        results[index] = savedResults[index];
        completedRequests++;
        const progress = Math.round((completedRequests / totalLinks) * 100);
        const elapsed = (Date.now() - downloadStartTime) / 1000;
        const speed = (completedRequests / elapsed).toFixed(2);
        const remaining = Math.ceil((totalLinks - completedRequests) / speed / 60);
        progressBar.style.width = `${progress}%`;
        progressBar.textContent = `${progress}% (${completedRequests}/${totalLinks}) | ${speed}章/秒 | 剩余${remaining}分钟`;
        return;
      }

      const url = link.href;
      const chapterTitle = link.innerText.trim();
      const requestStartTime = Date.now(); // 记录请求开始时间

      console.log(`📥 [下载章节#${index + 1}] ${chapterTitle}`);
      console.log(`   URL: ${url}`);

      try {
        results[index] = await fetchContent(url, link);

        // 记录响应时间（用于智能限流）
        const responseTime = Date.now() - requestStartTime;
        responseTimes.push(responseTime);

        console.log(`✅ [下载成功#${index + 1}] ${chapterTitle} (${responseTime}ms)`);

        // 每10个请求调整一次并发数
        if (completedRequests % 10 === 0) {
          adjustConcurrency();
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          throw error; // 用户取消，直接抛出
        }
        if (retryCount < CONFIG.maxRetries) {
          console.warn(`🔄 [重试章节#${index + 1}] 第 ${retryCount + 1}/${CONFIG.maxRetries} 次: ${chapterTitle}`);
          await delay(CONSTANTS.RETRY_BASE_DELAY * (retryCount + 1)); // 指数退避
          return fetchAndParse(link, index, retryCount + 1);
        }
        console.error(`❌ [下载失败#${index + 1}] ${chapterTitle}: ${error.message}`);
        results[index] = { title: link.innerText, content: `抓取失败（已重试${CONFIG.maxRetries}次）: ${error.message}` };
        failedChapters.push({ index: index + startIndex + 1, title: link.innerText, error: error.message });
      } finally {
        // 增加完成计数（实际更新由定时器负责）
        completedRequests++;

        // 保存进度（节流优化：1秒保存一次，避免高频写入）
        const now = Date.now();
        if (now - lastSaveTime > CONSTANTS.PROGRESS_SAVE_THROTTLE || completedRequests === totalLinks) {
          const progressData = {
            startIndex,
            finalIndex,
            completedCount: completedRequests,
            totalLinks,
            totalChapters: chapters.length,
            results: results.filter(r => r) // 只保存已完成的
          };
          localStorage.setItem(`bqg_progress_${booktitle}`, JSON.stringify(progressData));
          console.log(`💾 [进度保存] ${completedRequests}/${totalLinks} 章 (${Math.round((completedRequests / totalLinks) * 100)}%)`);
          lastSaveTime = now;
        }
      }
    };

    // Promise Pool 并发控制
    async function promisePool(tasks, concurrency) {
      const executing = [];
      for (const task of tasks) {
        const p = task();
        executing.push(p);
        if (executing.length >= concurrency) {
          await Promise.race(executing);
          executing.splice(executing.findIndex(e => e === p || !e.isPending), 1);
        }
      }
      await Promise.all(executing);
    }

    const tasks = selectedLinks.map((link, index) => () => fetchAndParse(link, index));
    promisePool(tasks, CONFIG.concurrency)
      .then(() => {
      // 清除定时器
      if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
      }

      isDownloading = false;
      fetchButton.innerText = '开始下载';
      fetchButton.disabled = false;

      // 最后强制进度条到 100%（isDownloading 已为 false，不能走 updateProgressBar）
      progressBar.style.width = '100%';
      progressBar.textContent = `100% (${totalLinks}/${totalLinks}) | 下载完成`;

      console.log('═══════════════════════════════════════════════════════');
      console.log('🎉 [下载完成] 统计信息：');
      console.log(`  总章节: ${totalLinks}`);
      console.log(`  成功: ${results.filter(r => r && !r.content.includes('抓取失败')).length}`);
      console.log(`  失败: ${failedChapters.length}`);
      console.log(`  耗时: ${Math.round((Date.now() - downloadStartTime) / 1000)}秒`);
      console.log('═══════════════════════════════════════════════════════');

      // 清除进度（下载完成）
      const progressKey = `bqg_progress_${booktitle}`;
      localStorage.removeItem(progressKey);
      console.log(`🗑️ [清除缓存] 已删除进度缓存: ${progressKey}`);
      
      // === 内容质量检测 ===
      if (CONFIG.enableDetection) {
        const detections = [];

        // [已移除] 重复内容检测

        // 1. 检测广告内容
        let adCount = 0;
        const adDetails = [];
        results.forEach((r, idx) => {
          if (!r || !r.content) return;
          const chapterNo = startIndex + idx + 1;
          const adResult = ContentDetector.detectAds(r.content);
          if (adResult.isAd) {
            adCount++;
            adDetails.push({ chapterNo, title: r.title, ratio: adResult.ratio });
          }
        });
        if (adCount > 0) {
          detections.push(`<div style="margin-bottom:8px;"><strong>广告检测:</strong> ${adCount} 章疑似包含大量广告内容</div>`);
          console.group(`⚠️ [内容检测] 广告内容 — 共 ${adCount} 章`);
          adDetails.forEach(d => {
            console.warn(`  第${d.chapterNo}章 ${d.title}  广告词占比 ${d.ratio}`);
          });
          console.groupEnd();
        }

        // 2. 检测异常内容
        let abnormalCount = 0;
        const abnormalDetails = [];
        const abnormalConsole = [];
        results.forEach((r, idx) => {
          if (!r || !r.content) return;
          const chapterNo = startIndex + idx + 1;
          const issues = ContentDetector.detectAbnormal(r.content);
          if (issues.length > 0) {
            abnormalCount++;
            if (abnormalDetails.length < 5) {
              abnormalDetails.push(`<div style="margin-left:12px; font-size:10px; color:#999;">• ${r.title}: ${issues.join(', ')}</div>`);
            }
            // 截取内容前100字作为现场片段
            const snippet = r.content.trim().replace(/\s+/g, ' ').slice(0, 100);
            abnormalConsole.push({ chapterNo, title: r.title, issues, snippet });
          }
        });
        if (abnormalCount > 0) {
          detections.push(`<div style="margin-bottom:8px;"><strong>异常内容:</strong> ${abnormalCount} 章存在异常</div>`);
          detections.push(...abnormalDetails);
          console.group(`⚠️ [内容检测] 异常内容 — 共 ${abnormalCount} 章`);
          abnormalConsole.forEach(d => {
            console.group(`  第${d.chapterNo}章 ${d.title}`);
            console.warn(`  原因: ${d.issues.join(' | ')}`);
            console.log(`  内容片段: "${d.snippet}${d.snippet.length >= 100 ? '…' : ''}"`);
            console.groupEnd();
          });
          console.groupEnd();
        }
        
        // 显示检测结果
        if (detections.length > 0) {
          detectionResults.innerHTML = detections.join('');
          detectionResultsContainer.style.display = 'block';
        } else {
          detectionResults.innerHTML = '<div style="color:#66bb6a;">✓ 未发现明显质量问题</div>';
          detectionResultsContainer.style.display = 'block';
        }
      }
      
      // 显示失败章节信息（使用UI而非alert）
      if (failedChapters.length > 0) {
        failedChaptersList.innerHTML = failedChapters.map(f => 
          `<div style="margin:3px 0;">第${f.index}章: ${f.title}<br><span style="font-size:11px; color:#666;">错误: ${f.error}</span></div>`
        ).join('');
        failedChaptersInfo.style.display = 'block';
      } else {
        failedChaptersInfo.style.display = 'none';
      }
      
      // 生成下载文件
      console.log('📄 [生成文件] 开始生成TXT文件...');
      downlink.innerText = "若未开始自动下载，点击这里";
      generateDownloadFile();
      console.log(`✅ [文件生成] ${booktitle}.txt`);
      fetchButton.disabled = false;
    })
      .catch((error) => {
      // 清除定时器
      if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
      }

      console.log('═══════════════════════════════════════════════════════');
      console.log('❌ [下载异常/取消]');

      isDownloading = false;
      fetchButton.innerText = '开始下载';
      fetchButton.disabled = false;

      if (error.name === 'AbortError') {
        console.log(`⏸️ [用户取消] 已完成 ${completedRequests}/${totalLinks} 章`);
        console.log(`💾 [进度保存] 缓存键: bqg_progress_${booktitle}`);
        progressBar.textContent = '已取消（进度已保存）';
        showToast(`下载已取消，已完成 ${completedRequests}/${totalLinks} 章，下次可继续`, 'info', 4000);
      } else {
        console.error('❌ [错误详情]', error);
        showToast(`下载出错：${error.message}`, 'error', 5000);
      }
    });

  });
})();
