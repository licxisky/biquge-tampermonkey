// 手动元素标记器模块
// 功能：用户手动点选 DOM 元素生成选择器

import { SiteRuleManager } from './site-rule-manager.js';

// Toast 辅助函数
function showToast(msg, type = 'success', duration = 2500) {
  console.log(`[${type}] ${msg}`);
}

// 当前站点选择器（从外部传入）
let currentSiteSelector = null;

export const ElementPicker = {
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
    currentSiteSelector = selector;
  },

  start(mode, onComplete) {
    console.log('🎯 [ElementPicker] 启动手动标记模式:', mode);
    this._mode = mode;
    this._picked = {};
    this._onComplete = onComplete || null;
    this._createToolbar();
    this._bindEvents();
    document.documentElement.classList.add('bqg-picker-mode');
    showToast(`🎯 已进入手动标记模式（${mode === 'toc' ? '目录页' : '内容页'}）`, 'info', 4000);
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
      showToast('已取消手动标记', 'info');
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

    const selector = this.generateSelector(el);
    console.log('🖱️ [ElementPicker] 用户点击元素:', {
      tagName: el.tagName,
      className: el.className,
      id: el.id,
      innerText: el.innerText?.substring(0, 50),
      textLength: el.innerText?.length,
      generatedSelector: selector
    });

    const menu = document.createElement('div');
    menu.id = 'bqg-picker-menu';
    menu.innerHTML = `
      <div style="font-size:11px;color:#999;margin-bottom:8px;">${selector}</div>
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
        console.log('❌ [ElementPicker] 用户取消标记');
        menu.remove(); this._menu = null;
        return;
      }

      const key = item.dataset.key;
      const sel = this.generateSelector(el);
      this._picked[key] = sel;

      console.log('✅ [ElementPicker] 标记元素:', {
        key,
        label: types.find(t => t.key === key)?.label,
        selector: sel,
        allPicked: this._picked
      });

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
            console.log('📋 [ElementPicker] 自动生成章节选择器:', chapSel);
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
    console.log('🏁 [ElementPicker] 用户点击完成，检查标记...');

    const types = this._modeTypes[this._mode] || [];
    const missing = types.filter(t => t.required && !this._picked[t.key]).map(t => t.label);
    if (missing.length > 0) {
      console.log('⚠️ [ElementPicker] 缺少必选项:', missing);
      showToast(`⚠️ 请先标记必选项：${missing.join('、')}`, 'warn', 3500);
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
      const base = currentSiteSelector || {};
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

    console.log('📋 [ElementPicker] 生成的规则:', rule);

    if (SiteRuleManager.addRule(rule)) {
      currentSiteSelector = { ...rule, custom: true };
      this.stop();
      showToast(`✅ 规则已保存并立即生效！`, 'success', 3500);
      console.log('✅ [ElementPicker] 规则已保存，调用回调函数');
      if (this._onComplete) this._onComplete(rule);
    } else {
      console.error('❌ [ElementPicker] 保存规则失败');
      showToast('保存规则失败，请查看控制台（F12）', 'error');
    }
  }
};
