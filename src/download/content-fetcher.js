// 内容抓取模块
// 功能：从章节页抓取内容

import { gmFetch } from '../core/http-client.js';
import { cleanContent } from '../core/content-cleaner.js';
import { CONFIG } from '../core/config.js';

let currentSiteSelector = null;

export function setCurrentSiteSelector(selector) {
  currentSiteSelector = selector;
}

export async function fetchContentWithIframe(url, contentSelector) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;

    let timeoutId;
    let checkInterval;

    const cleanup = () => {
      clearTimeout(timeoutId);
      clearInterval(checkInterval);
      iframe.src = 'about:blank';
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('iframe 加载超时'));
    }, CONFIG.timeout * 1000);

    iframe.onload = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        checkInterval = setInterval(() => {
          const contentDiv = iframeDoc.querySelector(contentSelector[0]) ||
                             iframeDoc.querySelector(contentSelector[1]) ||
                             iframeDoc.querySelector(contentSelector[2]);

          if (contentDiv && contentDiv.innerText.trim().length > CONFIG.minContentLength) {
            cleanup();

            // 克隆节点以避免修改原始 DOM
            const clonedDiv = contentDiv.cloneNode(true);

            // 移除广告和操作链接
            clonedDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
            clonedDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());

            // 特殊处理：章节标题在第一个 p 标签中
            const firstP = clonedDiv.querySelector('p:first-child');
            let title = '';
            if (firstP) {
              const firstPText = firstP.innerText.trim();
              // 检查是否像章节标题
              if (firstPText && (firstPText.includes('【') || firstPText.includes('《') || firstPText.includes('第')) && firstPText.length < 100) {
                title = firstPText;
                // 移除标题段落，避免重复
                firstP.remove();
              }
            }

            // 处理换行：先替换 <br> 标签
            clonedDiv.innerHTML = clonedDiv.innerHTML.replace(/<br\s*\/?>/gi, '\n');

            // 在每个块级元素（p, div）后添加换行符，处理使用段落换行的情况
            clonedDiv.querySelectorAll('p, div').forEach(el => {
              el.after(document.createTextNode('\n'));
            });

            if (!title) title = iframeDoc.querySelector('h1')?.innerText || '';
            const content = cleanContent(clonedDiv.innerText);

            resolve({ title, content });
          }
        }, 200);

      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    iframe.onerror = () => {
      cleanup();
      reject(new Error('iframe 加载失败'));
    };

    document.body.appendChild(iframe);
  });
}

export async function fetchContent(url, link) {
  let allContent = '';
  let title = '';

  async function fetchPage(pageUrl) {
    const response = await gmFetch(pageUrl);

    if (!response.ok) {
      const errorMsg = response.status === 404 ? '章节不存在(404)' :
                       response.status === 403 ? '访问被拒绝(403)' :
                       response.status === 503 ? '服务器现在无法处理请求(503)' :
                       response.status >= 500 ? `服务器错误(${response.status})` :
                       `HTTP 错误(${response.status})`;
      throw new Error(errorMsg);
    }

    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');

    // 登录页面检测
    const isLoginPage = (() => {
      const finalUrl = response.url || pageUrl;
      if (/login|signin|auth/i.test(finalUrl)) return true;

      const loginForms = doc.querySelectorAll('form[action*="login"], form#login, .login-form, .signin-form, #loginForm');
      if (loginForms.length > 0) return true;

      const title = doc.title || '';
      if (/登录|登录页|请登录|用户登录/i.test(title)) return true;

      const hasLoginPrompt = /请先登录|需要登录|未登录|登录后阅读|登录后继续/i.test(text);
      const hasContentElement = currentSiteSelector?.content?.some(sel => doc.querySelector(sel));

      if (hasLoginPrompt && !hasContentElement) return true;

      if (response.url && response.url !== pageUrl && /login|signin|auth/i.test(response.url)) return true;

      return false;
    })();

    if (isLoginPage) {
      throw new Error('需要登录才能查看此章节');
    }

    // 使用站点配置的内容选择器
    let contentDiv = null;
    if (currentSiteSelector?.content) {
      for (const selector of currentSiteSelector.content) {
        contentDiv = doc.querySelector(selector);
        if (contentDiv) break;
      }
    }

    if (!contentDiv) {
      contentDiv = doc.querySelector('div#content') || doc.querySelector('#chaptercontent') || doc.querySelector('.content');
    }

    if (contentDiv) {
      // 克隆节点以避免修改原始 DOM
      const clonedDiv = contentDiv.cloneNode(true);

      // 移除广告和操作链接
      clonedDiv.querySelectorAll('div#device').forEach(ad => ad.remove());
      clonedDiv.querySelectorAll('p.readinline > a[href*="javascript:"]').forEach(op => op.remove());

      // 特殊处理：alicesw.com 等站点的章节标题在第一个 p 标签中
      const firstP = clonedDiv.querySelector('p:first-child');
      if (firstP) {
        const firstPText = firstP.innerText.trim();
        // 检查是否像章节标题（包含【】或《》等特殊字符，且长度适中）
        if (firstPText && (firstPText.includes('【') || firstPText.includes('《') || firstPText.includes('第')) && firstPText.length < 100) {
          // 如果还没有标题，使用第一个段落作为标题
          if (!title) {
            title = firstPText;
          }
          // 移除标题段落，避免重复
          firstP.remove();
        }
      }

      // 处理换行：先替换 <br> 标签
      clonedDiv.innerHTML = clonedDiv.innerHTML.replace(/<br\s*\/?>/gi, '\n');

      // 在每个块级元素（p, div）后添加换行符，处理使用段落换行的情况
      clonedDiv.querySelectorAll('p, div').forEach(el => {
        el.after(document.createTextNode('\n'));
      });

      // 获取文本内容
      const extractedContent = clonedDiv.innerText.trim();
      const cleanedContent = cleanContent(extractedContent);

      if (cleanedContent.length < CONFIG.minContentLength) {
        console.warn(`[异步加载检测] ${pageUrl} 内容过短，尝试使用 iframe`);
        try {
          const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector?.content || ['div#content']);
          allContent += iframeResult.content + '\n\n';
          if (!title && iframeResult.title) title = iframeResult.title;
          return;
        } catch (iframeError) {
          console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
          allContent += cleanedContent + '\n\n';
        }
      } else {
        allContent += cleanedContent + '\n\n';
      }
    } else {
      console.warn(`[异步加载检测] ${pageUrl} 未找到内容元素，尝试使用 iframe`);
      try {
        const iframeResult = await fetchContentWithIframe(pageUrl, currentSiteSelector?.content || ['div#content']);
        allContent += iframeResult.content + '\n\n';
        if (!title && iframeResult.title) title = iframeResult.title;
      } catch (iframeError) {
        console.error(`[iframe 加载失败] ${pageUrl}:`, iframeError);
        throw new Error('无法获取章节内容（元素不存在且 iframe 加载失败）');
      }
    }

    if (doc.querySelector('h1')) {
      title = doc.querySelector('h1').innerText;
    }

    // 处理下一页
    const nextPage = doc.querySelector('.read-page a[href][rel="next"]');
    if (nextPage && nextPage.innerText === '下一页') {
      const nextUrl = nextPage.href.startsWith('http') ? nextPage.href : new URL(nextPage.href, pageUrl).href;
      await fetchPage(nextUrl);
    }
  }

  await fetchPage(url);

  if (link && !title) {
    title = link.innerText;
  }

  return { title, content: allContent };
}
