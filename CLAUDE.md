# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

笔趣阁小说下载器 - Tampermonkey/Greasemonkey 用户脚本。在小说目录页运行，支持断点续传、智能限流、内容清洗、站点规则管理等功能。

## 文件结构

```
biquge/
└── 笔趣阁下载器.user.js    # 单文件用户脚本 (~2900 行)
```

## 核心架构

### 配置层 (行 44-112)
- `CONFIG`: localStorage 持久化的运行配置（并发数、重试、限流阈值等）
- `CONSTANTS`: 魔法数字常量化（检测间隔、延迟、阈值等）
- `SITE_SELECTORS`: 数据驱动的站点选择器策略配置

### 功能模块
| 模块 | 位置 | 职责 |
|------|------|------|
| `RuleAnalyzer` | 115-593 | 智能规则分析 - 自动提取目录页/内容页的 CSS 选择器 |
| `CleanRuleManager` | 594-774 | 清洗规则管理 - 管理用于移除广告/域名的正则规则 |
| `SiteRuleManager` | 775-841 | 站点规则管理 - 增删改查站点选择器规则 |
| `ContentDetector` | 842-949 | 内容质量检测 - 重复/广告/异常内容检测 |
| `SpeedChart` | 950-1428 | Canvas 实时速度图表 |

### 核心函数
| 函数 | 位置 | 职责 |
|------|------|------|
| `detectSiteStructure()` | 1677 | 检测当前站点并匹配选择器策略 |
| `cleanContent()` | 1689 | 应用清洗规则移除垃圾内容 |
| `adjustConcurrency()` | 1700 | 智能限流 - 根据响应时间动态调整并发数 |
| `downloadMenu()` | 1721 | 下载菜单入口 - 显示模态框并启动下载 |
| `generateDownloadFile()` | 2447 | 生成 TXT 文件并触发下载 |

### UI 层
- 模态框: `fetchContentModal` (主下载)、`configModal` (配置)、`ruleModal` (规则)、`previewModal` (预览)、`ruleAnalyzerModal` (规则分析)
- 进度条、速度图表、检测结果容器

## 开发注意事项

### 版本发布流程
1. 更新 `@version` (行 4)
2. 更新 `@description` 中的版本号
3. 提交到 GreasyFork: https://greasyfork.org/scripts/500170

### 站点适配
新增站点支持优先通过 `RuleAnalyzer` 自动分析，手动配置规则存储在 `localStorage.bqg_siteRules`。

### CSS 选择器优先级
`SITE_SELECTORS` 数组顺序即为匹配优先级，新增站点时注意顺序。

### 智能限流逻辑
- 响应时间 > 3000ms → 降低并发
- 响应时间 < 1000ms → 提高并发
- 并发范围: 3-15 (可配置)

### 清洗规则检测
`RuleAnalyzer.detectCleanPatterns()` 支持识别 6 种垃圾内容模式：
1. 域名广告（含变体分隔符）
2. 重复英文短语
3. 重复中文短语
4. URL 链接
5. 站点推广文案
6. 高频异常词汇
