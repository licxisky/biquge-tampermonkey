// 模态框管理模块
// 功能：创建和管理各种模态框

import { modalHtml } from './modal-templates.js';
import { detectSiteStructure } from '../core/site-detector.js';
import { CONFIG, CONSTANTS } from '../core/config.js';
import { RuleAnalyzer } from '../rules/rule-analyzer.js';
import { SiteRuleManager } from '../rules/site-rule-manager.js';
import { CleanRuleManager } from '../rules/clean-rule-manager.js';
import { ElementPicker } from '../rules/element-picker.js';
import { DownloadOrchestrator } from '../download/orchestrator.js';
import { gmFetch } from '../core/http-client.js';

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

export const ModalManager = {
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
