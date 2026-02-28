// 智能限流模块
// 功能：根据响应时间动态调整并发数

import { CONFIG, CONSTANTS } from './config.js';

export let responseTimes = [];

export function adjustConcurrency() {
  if (responseTimes.length < CONSTANTS.PROGRESS_SAMPLE_SIZE) return;

  const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const oldConcurrency = CONFIG.concurrency;

  if (avgTime > CONSTANTS.SLOW_RESPONSE_THRESHOLD && CONFIG.concurrency > CONFIG.throttleMin) {
    CONFIG.concurrency = Math.max(CONFIG.throttleMin, CONFIG.concurrency - 1);
    console.log(`[智能限流] 响应慢(${avgTime.toFixed(0)}ms)，降低并发: ${oldConcurrency} → ${CONFIG.concurrency}`);
  } else if (avgTime < CONSTANTS.FAST_RESPONSE_THRESHOLD && CONFIG.concurrency < CONFIG.throttleMax) {
    CONFIG.concurrency = Math.min(CONFIG.throttleMax, CONFIG.concurrency + 1);
    console.log(`[智能限流] 响应快(${avgTime.toFixed(0)}ms)，提升并发: ${oldConcurrency} → ${CONFIG.concurrency}`);
  }

  // 只保留最近的样本
  if (responseTimes.length > CONSTANTS.PROGRESS_SAMPLE_MAX) {
    responseTimes = responseTimes.slice(-CONSTANTS.PROGRESS_SAMPLE_MAX);
  }
}

export function resetResponseTimes() {
  responseTimes = [];
}
