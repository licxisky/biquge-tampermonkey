// 配置管理模块
// 功能：从 localStorage 加载/保存配置

// 常量定义（消除魔法数字）
export const CONSTANTS = {
  IFRAME_CHECK_INTERVAL: 200,
  RETRY_BASE_DELAY: 1000,
  PROGRESS_SAVE_THROTTLE: 1000,
  PROGRESS_SAMPLE_SIZE: 10,
  PROGRESS_SAMPLE_MAX: 20,
  CONCURRENCY_MIN: 3,
  CONCURRENCY_MAX: 15,
  SLOW_RESPONSE_THRESHOLD: 3000,
  FAST_RESPONSE_THRESHOLD: 1000,
};

// 配置管理器
export const CONFIG = new Proxy({
  concurrency: parseInt(localStorage.getItem('bqg_concurrency') || '8'),
  maxRetries: parseInt(localStorage.getItem('bqg_maxRetries') || '3'),
  timeout: parseInt(localStorage.getItem('bqg_timeout') || '10'),
  minContentLength: parseInt(localStorage.getItem('bqg_minContentLength') || '50'),
  throttleMin: parseInt(localStorage.getItem('bqg_throttleMin') || '3'),
  throttleMax: parseInt(localStorage.getItem('bqg_throttleMax') || '15'),
  enablePreview: localStorage.getItem('bqg_enablePreview') !== 'false',
  previewCount: parseInt(localStorage.getItem('bqg_previewCount') || '3'),
  enableDetection: localStorage.getItem('bqg_enableDetection') !== 'false',
  duplicateThreshold: parseFloat(localStorage.getItem('bq_duplicateThreshold') || '0.85'),
  adThreshold: parseInt(localStorage.getItem('bqg_adThreshold') || '20'),
  disableResume: localStorage.getItem('bqg_disableResume') === 'true',
  maxTocPages: parseInt(localStorage.getItem('bqg_maxTocPages') || '10'),
  maxTocPagesHardLimit: 50,
  maxTotalChapters: 5000,
}, {
  set(target, key, value) {
    target[key] = value;
    localStorage.setItem(`bqg_${key}`, value);
    return true;
  }
});
