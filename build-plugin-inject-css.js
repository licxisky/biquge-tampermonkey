// Rollup 插件：CSS 注入到 GM_addStyle()
// 功能：将导入的 .css 文件转换为 GM_addStyle() 调用

import { readFileSync } from 'fs';
import { resolve } from 'path';

export function injectCSS() {
  return {
    name: 'inject-css',

    // 构建转换钩子
    transform(code, id) {
      // 只处理 .css 文件
      if (!id.endsWith('.css')) return null;

      // 读取 CSS 内容
      const cssContent = readFileSync(id, 'utf-8');

      // 转换为 GM_addStyle() 调用
      const jsCode = `
// ===== CSS: ${id.split('/').pop()} =====
GM_addStyle(\`${escapeBackticks(cssContent)}\`);
`;

      return {
        code: jsCode,
        map: null
      };
    },

    // 解析钩子：处理 .css 导入
    resolveId(source, importer) {
      if (source.endsWith('.css')) {
        return resolve(importer, '..', source);
      }
      return null;
    },

    // 加载钩子
    load(id) {
      if (id.endsWith('.css')) {
        return '';
      }
      return null;
    }
  };
}

// 转义反引号
function escapeBackticks(str) {
  return str
    .replace(/\\/g, '\\\\')    // 反斜杠
    .replace(/`/g, '\\`')      // 反引号
    .replace(/\$/g, '\\$');    // 美元符号
}
