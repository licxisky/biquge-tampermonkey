// 笔趣阁下载器 - 入口文件
// 功能：模块组装、初始化

// ========== 核心模块 ==========
import { CONFIG, CONSTANTS } from './core/config.js';
import { gmFetch } from './core/http-client.js';
import { detectSiteStructure } from './core/site-detector.js';
import { cleanContent } from './core/content-cleaner.js';
import { adjustConcurrency } from './core/throttle.js';

// ========== 规则模块 ==========
import { RuleAnalyzer } from './rules/rule-analyzer.js';
import { CleanRuleManager } from './rules/clean-rule-manager.js';
import { SiteRuleManager } from './rules/site-rule-manager.js';
import { ElementPicker } from './rules/element-picker.js';

// ========== 下载引擎 ==========
import { DownloadOrchestrator } from './download/orchestrator.js';
import { fetchContent } from './download/content-fetcher.js';
import { promisePool } from './download/promise-pool.js';
import { ProgressTracker } from './download/progress-tracker.js';
import { RetryManager } from './download/retry-manager.js';

// ========== UI 模块 ==========
import './ui/theme.css';  // 注入样式
import { ModalManager } from './ui/modals.js';
import { ToastManager } from './ui/toast.js';
import { ProgressBar } from './ui/progress-bar.js';

// ========== 质量检测 ==========
import { ContentDetector } from './quality/content-detector.js';

// ========== 数据 ==========
import { SITE_SELECTORS } from './data/site-selectors.js';

// ========== 全局暴露（油猴脚本兼容性）==========
(function() {
  'use strict';

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
    // 添加章节页下载按钮
    addChapterDownloadButton();
    // 添加固定浮动下载按钮
    addFloatingDownloadButton();
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

  // 添加下载单章按钮到内容页
  function addChapterDownloadButton() {
    // 检查是否已经在目录页（目录页不应该显示单章下载按钮）
    if (document.querySelector('button#downloadMenuBtn')) return false;

    // 防止重复添加按钮
    if (document.querySelector('button#downloadChapterBtn')) return false;

    // 检测当前站点
    let currentSite = null;

    // 1. 先尝试 hostname 匹配（针对 pixiv 等特殊站点）
    const currentHostname = window.location.hostname;
    const getMainDomain = (hostname) => hostname.replace(/^www\./, '');

    for (const selector of SITE_SELECTORS) {
      if (selector.hostname) {
        const hostnameMatch = selector.hostname === currentHostname ||
                               getMainDomain(selector.hostname) === getMainDomain(currentHostname);
        if (hostnameMatch) {
          currentSite = selector;
          console.log(`[章节页按钮] 通过 hostname 匹配到站点: ${selector.name}`);
          break;
        }
      }
    }

    // 2. 如果 hostname 匹配失败，使用常规检测
    if (!currentSite) {
      currentSite = detectSiteStructure();
      if (!currentSite) {
        console.log('[章节页按钮] 站点检测失败');
        return false;
      }
    }

    // 获取内容选择器
    const contentSelectors = currentSite.content || [];
    if (!contentSelectors.length) {
      console.log('[章节页按钮] 没有内容选择器');
      return false;
    }

    // 检查是否存在内容元素
    let contentElement = null;
    for (const selector of contentSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        // 检查内容长度，确保是真正的章节内容
        const textLength = el.innerText.trim().length;
        console.log(`[章节页按钮] 选择器 "${selector}": 找到元素，内容长度=${textLength}`);
        if (textLength > 50) {
          contentElement = el;
          break;
        }
      }
    }

    // 如果没有找到内容元素，说明不是章节页
    if (!contentElement) {
      console.log('[章节页按钮] 未找到有效内容元素');
      return false;
    }

    // 查找合适的标题元素来放置按钮
    const h1Candidates = Array.from(document.querySelectorAll("h1, h2"));
    let targetHeading = h1Candidates.find(h => {
      const className = h.className || '';
      const parentId = h.parentElement?.id || '';
      const parentClass = h.parentElement?.className || '';
      const excludePatterns = [
        /logo/i, /header/i, /nav/i, /footer/i,
        /banner/i, /topbar/i, /navbar/i, /comment/i
      ];
      return !excludePatterns.some(p => p.test(className) || p.test(parentId) || p.test(parentClass));
    });

    if (!targetHeading) return false;

    const btn = document.createElement("button");
    btn.innerText = "📖 下载本章";
    btn.id = "downloadChapterBtn";
    btn.style.cssText = "padding:4px 12px; margin:0 0 0 10px; font-size:14px; font-weight:500; background:linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color:white; border:none; border-radius:6px; cursor:pointer; vertical-align:middle;";
    btn.addEventListener('click', () => {
      DownloadOrchestrator.downloadCurrentChapter();
    });

    // 尝试在标题的文本内容之后插入按钮
    let textNode = null;
    for (let i = 0; i < targetHeading.childNodes.length; i++) {
      if (targetHeading.childNodes[i].nodeType === Node.TEXT_NODE && targetHeading.childNodes[i].textContent.trim()) {
        textNode = targetHeading.childNodes[i];
        break;
      }
    }

    if (textNode) {
      if (textNode.nextSibling) {
        targetHeading.insertBefore(btn, textNode.nextSibling);
      } else {
        targetHeading.appendChild(btn);
      }
    } else {
      targetHeading.appendChild(btn);
    }

    console.log('✅ [章节页] 已添加下载单章按钮');
    return true;
  }

  // 添加固定浮动下载按钮
  function addFloatingDownloadButton() {
    // 防止重复添加
    if (document.querySelector('#bqg-floating-download-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'bqg-floating-download-btn';
    btn.innerHTML = '📖<br><span style="font-size:10px;">下载</span>';
    btn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      z-index: 99998;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1.2;
      transition: all 0.3s ease;
      user-select: none;
    `.replace(/\s+/g, ' ').trim();

    // 悬停效果
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.1)';
      btn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });

    // 点击事件
    btn.addEventListener('click', () => {
      DownloadOrchestrator.downloadCurrentChapter();
    });

    // 添加到页面
    document.body.appendChild(btn);

    console.log('✅ [浮动按钮] 已添加固定下载按钮');
    return true;
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }

})();
