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
