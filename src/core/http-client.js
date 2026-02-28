// HTTP 客户端模块
// 功能：GM_xmlhttpRequest Promise 封装，绕过 CORS

export function gmFetch(url) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: (response) => {
          const headersObj = {};
          if (response.responseHeaders) {
            const headerLines = response.responseHeaders.split('\r\n');
            for (const line of headerLines) {
              const colonIndex = line.indexOf(':');
              if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                headersObj[key] = value;
              }
            }
          }

          resolve({
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText,
            url: response.finalUrl || response.responseURL,
            text: () => Promise.resolve(response.responseText),
            headers: headersObj,
            _rawHeaders: response.responseHeaders
          });
        },
        onerror: () => reject(new Error('GM_xmlhttpRequest 请求失败')),
        ontimeout: () => reject(new Error('GM_xmlhttpRequest 请求超时'))
      });
    } else {
      fetch(url).then(resolve).catch(reject);
    }
  });
}
