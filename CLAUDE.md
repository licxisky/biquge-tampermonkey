# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

笔趣阁小说下载器 - Tampermonkey/Greasemonkey 用户脚本（v0.9.14）。在小说目录页运行，支持断点续传、智能限流、内容清洗、站点规则管理等功能。

**源码**在 `src/` 目录，**构建产物**为 `dist/笔趣阁下载器.user.js`（Rollup 打包为单文件 IIFE）。根目录的 `笔趣阁下载器.user.js` 是旧版遗留文件，不再维护。

## 构建与开发

```bash
npm install          # 安装依赖（rollup、terser）
npm run dev          # 监听模式构建（含 source map）
npm run build        # 一次性构建（含 source map）
npm run build:prod   # 生产构建（代码压缩，无 source map）
```

构建产物：`dist/笔趣阁下载器.user.js`，直接安装到 Tampermonkey 测试。无自动化测试套件，测试方式见 [TESTING.md](TESTING.md)。

## 架构

模块化 ES Module 源码，Rollup 打包为油猴兼容的 IIFE 格式。

```
src/
├── main.js                      # 入口：模块组装、GM 菜单注册、页面初始化
├── core/
│   ├── config.js                # CONFIG（Proxy 自动持久化到 localStorage）、CONSTANTS
│   ├── http-client.js           # gmFetch() - 封装 GM_xmlhttpRequest
│   ├── site-detector.js         # detectSiteStructure() - 匹配站点选择器规则
│   ├── content-cleaner.js       # cleanContent() - 应用正则清洗规则
│   └── throttle.js              # adjustConcurrency() - 根据响应时间动态调整并发
├── data/
│   └── site-selectors.js        # SITE_SELECTORS 数组（顺序即优先级）
├── download/
│   ├── orchestrator.js          # DownloadOrchestrator - 下载流程编排
│   ├── content-fetcher.js       # fetchContent() - 单章内容抓取
│   ├── promise-pool.js          # promisePool() - 有界并发池
│   ├── progress-tracker.js      # ProgressTracker - 断点续传状态
│   └── retry-manager.js         # RetryManager - 指数退避重试
├── rules/
│   ├── rule-analyzer.js         # RuleAnalyzer - 自动提取 CSS 选择器
│   ├── clean-rule-manager.js    # CleanRuleManager - 清洗规则 CRUD
│   ├── site-rule-manager.js     # SiteRuleManager - 站点规则 CRUD
│   └── element-picker.js        # ElementPicker - 交互式元素选取
├── ui/
│   ├── theme.css                # 样式（由 build-plugin-inject-css.js 注入）
│   ├── modal-templates.js       # HTML 模板字符串
│   ├── modals.js                # ModalManager - 弹窗统一管理
│   ├── toast.js                 # ToastManager - 轻提示
│   └── progress-bar.js          # ProgressBar - 进度条组件
└── quality/
    └── content-detector.js      # ContentDetector - 重复/广告/异常内容检测
```

## 项目约定

### CONFIG 持久化模式
`CONFIG` 是 Proxy 对象，赋值自动写入 `localStorage`（key 前缀 `bqg_`）。直接 `CONFIG.concurrency = 5` 即可持久化，禁止手动调用 `localStorage.setItem`。

### CSS 注入
`src/ui/theme.css` 通过自定义 Rollup 插件 `build-plugin-inject-css.js` 在构建时注入为 `GM_addStyle(...)` 调用，无需手动处理。

### 站点选择器优先级
`src/data/site-selectors.js` 中 `SITE_SELECTORS` 数组顺序即为匹配优先级，新增站点规则时注意插入位置。

### 智能限流逻辑
- 响应时间 > `SLOW_RESPONSE_THRESHOLD`（3000ms）→ 降低并发
- 响应时间 < `FAST_RESPONSE_THRESHOLD`（1000ms）→ 提高并发
- 并发范围：`CONCURRENCY_MIN`(3) ~ `CONCURRENCY_MAX`(15)，均可通过 CONFIG 覆盖

### 清洗规则检测
`RuleAnalyzer.detectCleanPatterns()` 识别 6 种垃圾模式：域名广告、重复英文短语、重复中文短语、URL、站点推广文案、高频异常词汇。

## 版本发布流程

1. 更新 `package.json` 中的 `version`
2. 同步更新 `rollup.config.js` banner 中的 `@version` 和 `@description`
3. `npm run build:prod` 生成压缩产物
4. 提交到 GreasyFork: https://greasyfork.org/scripts/500170
