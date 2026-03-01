// 下载编排模块
// 功能：协调整个下载流程

import { fetchContent, fetchContentWithIframe, setCurrentSiteSelector } from './content-fetcher.js';
import { promisePool } from './promise-pool.js';
import { ProgressTracker } from './progress-tracker.js';
import { RetryManager } from './retry-manager.js';
import { CONFIG, CONSTANTS } from '../core/config.js';
import { adjustConcurrency, resetResponseTimes } from '../core/throttle.js';
import { ContentDetector } from '../quality/content-detector.js';
import { detectSiteStructure } from '../core/site-detector.js';
import { cleanContent } from '../core/content-cleaner.js';
import { gmFetch } from '../core/http-client.js';

// Toast 辅助函数
function showToast(msg, type = 'success', duration = 2500) {
  console.log(`[${type}] ${msg}`);
}

export const DownloadOrchestrator = {
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

    // 对于动态渲染站点（如 pixiv），添加等待重试机制
    if (!contentDiv) {
      console.log('⏳ 首次查找失败，等待页面渲染...');
      const maxRetries = 3;
      const retryDelay = 1000; // 1秒

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        // 重试站点配置选择器
        for (const selector of siteConfig.content) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 50) {
            contentDiv = el;
            console.log(`✅ 重试 ${attempt}/${maxRetries}：找到内容容器 (${selector})`);
            break;
          }
        }

        if (contentDiv) break;

        // 重试通用选择器
        for (const selector of ['div#content', '#chaptercontent', '.content', '#BookText', '.chapter-content', 'article', '.text-content', '.book-content']) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 100) {
            contentDiv = el;
            console.log(`✅ 重试 ${attempt}/${maxRetries}：使用通用选择器找到内容 (${selector})`);
            break;
          }
        }

        if (contentDiv) break;
      }
    }

    if (!contentDiv) {
      console.error('❌ [单章下载] 未找到内容元素');
      showToast('❌ 未找到章节内容元素', 'error');
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

    // 处理换行：先替换 <br> 标签，然后处理块级元素
    clonedContentDiv.innerHTML = clonedContentDiv.innerHTML.replace(/<br\s*\/?>/gi, '\n');
    clonedContentDiv.querySelectorAll('p, div').forEach(el => {
      el.after(document.createTextNode('\n'));
    });

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
    showToast(`✅ 已下载：${title}\n${contentLength}字`, 'success', 3000);
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
