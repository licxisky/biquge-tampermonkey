// 内容质量检测模块
// 功能：检测内容重复、广告、异常等问题

import { CONFIG } from '../core/config.js';

export const ContentDetector = {
  // Simhash 算法：检测重复内容
  simhash(text) {
    const hash = new Array(64).fill(0);
    const words = text.match(/[\u4e00-\u9fa5]+/g) || [];

    words.forEach(word => {
      let wordHash = 0;
      for (let i = 0; i < word.length; i++) {
        wordHash = (wordHash * 31 + word.charCodeAt(i)) & 0xFFFFFFFF;
      }

      for (let i = 0; i < 64; i++) {
        const bit = (wordHash >> i) & 1;
        hash[i] += bit ? 1 : -1;
      }
    });

    return hash.map(v => v > 0 ? 1 : 0).join('');
  },

  // 计算汉明距离（相似度）
  similarity(hash1, hash2) {
    let distance = 0;
    for (let i = 0; i < 64; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return 1 - distance / 64;
  },

  // 检测重复内容
  detectDuplicate(chapters) {
    const hashes = chapters.map(ch => ({
      index: ch.index,
      title: ch.title,
      hash: this.simhash(ch.content)
    }));

    const duplicates = [];
    for (let i = 0; i < hashes.length - 1; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        const sim = this.similarity(hashes[i].hash, hashes[j].hash);
        if (sim >= CONFIG.duplicateThreshold) {
          duplicates.push({
            chapter1: hashes[i].title,
            chapter2: hashes[j].title,
            similarity: (sim * 100).toFixed(1) + '%'
          });
        }
      }
    }
    return duplicates;
  },

  // 检测广告内容
  detectAds(content) {
    const adKeywords = [
      '推荐', '新书', '收藏', '投票', '月票', '打赏', '订阅',
      '关注', '公众号', '微信', 'QQ群', '书友群', '作者', '求',
      '跪求', '拜求', '官网', '最新章节', '最快更新', '首发'
    ];

    let adCount = 0;
    const words = content.match(/[\u4e00-\u9fa5]+/g) || [];
    words.forEach(word => {
      if (adKeywords.some(kw => word.includes(kw))) adCount++;
    });

    const adRatio = words.length > 0 ? (adCount / words.length) * 100 : 0;
    return {
      isAd: adRatio > CONFIG.adThreshold,
      ratio: adRatio.toFixed(1) + '%'
    };
  },

  // 检测异常内容
  detectAbnormal(content) {
    const issues = [];

    // 检测内容过短
    if (content.length < 100) {
      const snippet = content.trim().replace(/\s+/g, ' ').slice(0, 30);
      issues.push(snippet ? `内容过短: "${snippet}${content.trim().length > 30 ? '…' : ''}"` : '内容过短(空)');
    }

    // 检测乱码（连续特殊字符）
    if (/[^\u4e00-\u9fa5\w\s]{10,}/.test(content)) {
      issues.push('疑似乱码');
    }

    // 检测404或错误提示
    const strictErrorRe = /404|not\s*found|章节不存在/i;
    const looseErrorRe = /出错|错误/i;
    const useLoose = content.length < 100;

    if (strictErrorRe.test(content) || (useLoose && looseErrorRe.test(content))) {
      const combinedRe = useLoose
        ? /(.{0,10}(?:404|not\s*found|章节不存在|出错|错误).{0,10})/i
        : /(.{0,10}(?:404|not\s*found|章节不存在).{0,10})/i;
      const match = content.match(combinedRe);
      const snippet = match ? match[1].replace(/\s+/g, ' ').trim().slice(0, 25) : '';
      issues.push(snippet || '章节不存在或出错');
    }

    return issues;
  }
};
