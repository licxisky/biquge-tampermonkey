// 重试管理模块
// 功能：管理失败请求的重试逻辑

import { CONFIG, CONSTANTS } from '../core/config.js';

export const RetryManager = {
  async retry(fetchFn, maxRetries = CONFIG.maxRetries) {
    let lastError;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fetchFn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries) {
          const delay = CONSTANTS.RETRY_BASE_DELAY * (i + 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  },

  // 指数退避延迟
  getDelay(retryCount) {
    return CONSTANTS.RETRY_BASE_DELAY * (retryCount + 1);
  }
};
