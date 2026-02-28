// Rollup 配置 - 笔趣阁下载器
import { injectCSS } from './build-plugin-inject-css.js';

const isProduction = process.env.PRODUCTION;

export default {
  // 入口文件
  input: 'src/main.js',

  // 输出配置
  output: {
    file: 'dist/笔趣阁下载器.user.js',
    format: 'iife',           // 立即执行函数表达式（油猴兼容）
    name: 'BQGApp',           // 全局变量名
    sourcemap: !isProduction, // 开发模式生成 source map
    banner: '// ==UserScript==\n' +
            '// @name         笔趣阁下载器\n' +
            '// @namespace    http://tampermonkey.net/\n' +
            '// @version      0.9.14\n' +
            '// @description  可在笔趣阁下载小说（TXT格式）。\n' +
            '// @author       Licxisky\n' +
            '// @match        *://*/*\n' +
            '// @exclude      *://baidu.com/*\n' +
            '// @exclude      *://*.baidu.com/*\n' +
            '// @license      GPL-3.0\n' +
            '// @grant        GM_registerMenuCommand\n' +
            '// @grant        GM_addStyle\n' +
            '// @grant        GM_xmlhttpRequest\n' +
            '// @namespace    https://greasyfork.org/scripts/500170\n' +
            '// @supportURL   https://greasyfork.org/scripts/500170\n' +
            '// @homepageURL  https://greasyfork.org/scripts/500170\n' +
            '// @icon         https://www.beqege.cc/favicon.ico\n' +
            '// @connect       *\n' +
            '// ==/UserScript==\n',
    footer: '\n// 生成时间: ' + new Date().toLocaleString('zh-CN')
  },

  // 插件
  plugins: [
    injectCSS(),              // CSS 注入插件
    isProduction && terser()  // 生产环境压缩
  ].filter(Boolean),

  // 外部依赖（不打包）
  external: [],

  // 上下文
  context: 'window'
};

// 生产环境压缩插件
function terser() {
  return {
    name: 'terser',
    async transform(code) {
      const { minify } = await import('terser');
      const result = await minify(code, {
        compress: {
          drop_console: false,  // 保留 console
          pure_funcs: []        // 不删除任何函数调用
        },
        format: {
          comments: /^==UserScript==|@/  // 保留油猴头部注释
        }
      });
      return {
        code: result.code,
        map: null
      };
    }
  };
}
