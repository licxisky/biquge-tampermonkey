# 笔趣阁下载器

> 一款强大的小说 TXT 下载工具 —— 支持断点续传、智能限流、内容清洗、站点规则管理

[![GreasyFork](https://img.shields.io/badge/GreasyFork-500170-green)](https://greasyfork.org/scripts/500170)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-0.9.2-orange)](https://greasyfork.org/scripts/500170)

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 🔄 **断点续传** | 下载中断后可继续，无需重新开始 |
| ⚡ **智能限流** | 根据响应时间自动调整并发数（3-15） |
| 🧹 **内容清洗** | 自动移除广告、域名推广等垃圾内容 |
| 📊 **实时图表** | Canvas 绘制下载速度曲线 |
| 🔍 **质量检测** | 检测重复内容、广告、异常文本 |
| 🛠️ **站点管理** | 支持自定义站点规则，智能分析选择器 |
| 👁️ **章节预览** | 下载前预览章节内容 |
| ⚙️ **高度可配** | 并发数、重试次数、超时等皆可调整 |

---

## 安装

### 前置要求

- [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) 或 [Greasemonkey](https://www.greasespot.net/) (Firefox)

### 安装步骤

1. 安装油猴插件
2. 访问 [GreasyFork 页面](https://greasyfork.org/scripts/500170) 点击「安装此脚本」
3. 刷新目标小说站点页面

---

## 使用方法

1. 打开小说**目录页**
2. 点击油猴图标，选择「笔趣阁下载器」
3. 在弹出的模态框中点击「开始下载」
4. 等待下载完成后自动保存 TXT 文件

---

## 配置说明

点击模态框中的「设置」按钮可调整以下参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 并发数 | 8 | 同时下载的章节数 |
| 重试次数 | 3 | 失败后的重试次数 |
| 超时时间 | 10 秒 | 单章节请求超时 |
| 限流下限 | 3 | 智能限流最小并发 |
| 限流上限 | 15 | 智能限流最大并发 |

---

## 支持站点

| 站点 | 状态 |
|------|------|
| beqege.cc | ✅ 已测试 |
| bigee.cc | ✅ 已测试 |
| bqgui.cc | ✅ 已测试 |
| bbiquge.la | ✅ 已测试 |
| 3bqg.cc | ✅ 已测试 |
| xbiqugew.com | ✅ 已测试 |
| bqg862.xyz | ✅ 已测试 |
| bqg283.cc | ✅ 已测试 |
| biquge.net | ✅ 已测试 |

> 兼容大多数笔趣阁类站点，遇到新站点可使用「智能规则分析」功能自动适配

---

## 常见问题

**Q: 下载失败怎么办？**
A: 点击「重试失败章节」按钮重新下载失败的章节

**Q: 如何清除缓存？**
A: 在设置中点击「清除所有缓存」按钮

**Q: 支持哪些格式？**
A: 目前仅支持导出 TXT 格式

**Q: 可以自定义站点吗？**
A: 可以，使用「站点规则」功能添加自定义选择器

---

## 技术架构

```
笔趣阁下载器.user.js (~2900 行)
├── 配置层          localStorage 持久化配置
├── 核心模块
│   ├── RuleAnalyzer        智能规则分析
│   ├── CleanRuleManager    清洗规则管理
│   ├── SiteRuleManager     站点规则管理
│   ├── ContentDetector     内容质量检测
│   └── SpeedChart          Canvas 速度图表
└── UI 层                   模态框、进度条、图表
```

---

## 许可证

[GPL-3.0](./LICENSE)

---

## 链接

- [GreasyFork 主页](https://greasyfork.org/scripts/500170)
- [问题反馈](https://greasyfork.org/scripts/500170/feedback)

---

> 仅供学习交流，请支持正版阅读
