// 规则分析器模块
// 功能：智能分析页面结构，提取选择器规则

export const RuleAnalyzer = {
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
