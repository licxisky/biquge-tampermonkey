# 适配新站点 Skill

## 功能描述

自动化/半自动化流程，用于为笔趣阁下载器脚本添加对新小说网站的支持。通过系统化的分析和配置，快速适配新的小说站点。

## 使用场景

当需要为笔趣阁下载器添加新网站支持时，使用此技能。

## 执行流程

### 1. 信息收集

**用户提供：**
- 目标网站的目录页 URL（必需）
- 示例章节 URL（可选，会自动检测）

### 2. 网站结构分析

**目录页分析：**
- 使用 Playwright 访问目录页
- 检测章节列表容器（`dl`、`.list-chapter`、`#list` 等）
- 提取章节链接模式（href 格式、父元素结构）
- 识别书名、作者等信息位置

**内容页分析：**
- 访问示例章节页面
- 检测内容容器（`#chaptercontent`、`#content`、`.content` 等）
- 识别章节标题位置（`h1` 等）
- 检查是否有跨域重定向

**自动提取：**
```javascript
// 提取目录页结构
const tocInfo = {
  chapterContainers: [], // 查找可能的列表容器
  chapterLinks: [],      // 提取章节链接样本
  tocPattern: ''         // 识别用的关键文本
};

// 提取内容页结构
const contentInfo = {
  contentSelectors: [],  // 内容容器候选
  titleSelectors: [],    // 标题候选
  redirectInfo: {}       // 重定向信息
};
```

### 3. 配置生成

根据分析结果生成站点配置：

```javascript
{
  name: '域名',
  toc: 'CSS选择器',
  tocPattern: '识别文本（可选）',
  chapters: '章节链接选择器',
  content: ['内容选择器1', '内容选择器2'],
  title: '标题选择器',
  bookInfo: '书籍信息选择器'
}
```

### 4. 代码修改

**修改文件：** `笔趣阁下载器.user.js`

**修改位置：**

1. **@match 规则**（约第 6-16 行）
   ```javascript
   // @match        https://域名/*/
   ```

2. **SITE_SELECTORS 数组**（约第 88-122 行）
   - 添加新站点配置对象
   - 设置合适的优先级位置

3. **detectSiteStructure 函数**（如需要）
   - 检查是否需要增强以支持新的匹配模式
   - 添加 `tocPattern` 支持等

4. **版本信息更新**
   ```javascript
   // @version      x.x.x  // 递增版本号
   // @description  ...|域名  // 添加到测试网址列表
   ```

### 5. 测试验证

**验证清单：**
- [ ] 目录页能正确识别为该站点
- [ ] 章节列表提取完整
- [ ] 内容页正确抓取
- [ ] 标题提取正确
- [ ] 跨域重定向正常（如有）
- [ ] 下载功能完整可用

### 6. 提交发布

**Git 提交：**
```bash
git add 笔趣阁下载器.user.js
git commit -m "feat: 新增 域名 站点支持"
git push
```

**更新 GreasyFork：**
- 访问 https://greasyfork.org/scripts/500170
- 上传更新后的脚本
- 更新版本说明

## 关键配置模式

### 常见目录页模式

| 网站类型 | toc 选择器 | chapters 选择器 |
|---------|-----------|----------------|
| 标准笔趣阁 | `#list` | `dl dd > a[href]` |
| 列表样式 | `.list-chapter` | `div.booklist > ul > li > a[href]` |
| 分区样式 | `div.section-box` | `div.section-box ul.section-list li > a[href]` |
| DL列表 | `dl` | `dl > dd > a[href*="/read/"]` |

### 常见内容页模式

| 选择器优先级 | 内容选择器 |
|-------------|-----------|
| 最高优先级 | `#chaptercontent` |
| 高优先级 | `div#content` |
| 中优先级 | `.content` |
| 低优先级 | `#htmlContent`, `div.reader-main` |

## 注意事项

1. **多 dl 元素区分**：使用 `tocPattern` 参数精确匹配
2. **跨域重定向**：内容页面可能在其他域名，确保 @match 覆盖
3. **选择器优先级**：SITE_SELECTORS 数组顺序即匹配优先级
4. **版本号规则**：主版本.次版本.补丁（如 0.9.3）
5. **测试网址格式**：域名，不含协议和路径

## 示例：snapd.net 适配

**分析结果：**
- 目录页：`https://www.snapd.net/read/171386/`
- 章节在 `dl > dd > a[href*="/read/"]`
- 识别文本："最新章节列表"
- 内容在 `#chaptercontent`

**生成配置：**
```javascript
{
  name: 'snapd.net',
  toc: 'dl',
  tocPattern: '最新章节列表',
  chapters: 'dl > dd > a[href*="/read/"]',
  content: ['#chaptercontent', 'div#content', '.content'],
  title: 'h1',
  bookInfo: 'h1'
}
```

**代码修改：**
- 添加 @match: `https://www.snapd.net/read/*/`
- 插入站点配置到 SITE_SELECTORS
- 增强 detectSiteStructure 支持 tocPattern
- 更新版本至 0.9.3

## 快速命令

```bash
# 1. 测试新站点
在浏览器中打开目标目录页

# 2. 启动适配流程
"请适配 [URL] 这个网站"

# 3. 自动化分析会：
# - 访问目录页
# - 提取章节链接
# - 访问内容页
# - 生成配置

# 4. 确认后自动修改代码并提交
```

## 相关文件

- 主脚本：`笔趣阁下载器.user.js`
- 配置位置：第 88-122 行（SITE_SELECTORS）
- 检测逻辑：第 1694-1712 行（detectSiteStructure）
- Match 规则：第 6-16 行（@match）

## 维护日志

- 2026-02-27: 创建 skill，基于 snapd.net 适配流程
