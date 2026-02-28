// 进度追踪模块
// 功能：追踪下载进度并更新进度条

export const ProgressTracker = {
  totalLinks: 0,
  completedRequests: 0,
  failedChapters: [],

  init(total, onUpdate) {
    this.totalLinks = total;
    this.completedRequests = 0;
    this.failedChapters = [];
    this.onUpdate = onUpdate;
  },

  increment() {
    this.completedRequests++;
    this._notify();
  },

  addFailure(chapter) {
    this.failedChapters.push(chapter);
  },

  getProgress() {
    return {
      progress: Math.round((this.completedRequests / this.totalLinks) * 100),
      completed: this.completedRequests,
      total: this.totalLinks,
      failed: this.failedChapters.length
    };
  },

  _notify() {
    if (this.onUpdate) {
      this.onUpdate(this.getProgress());
    }
  },

  startAutoUpdate(progressBar, interval = 200) {
    this.updateInterval = setInterval(() => {
      const p = this.getProgress();
      progressBar.style.width = `${p.progress}%`;
      progressBar.textContent = `${p.progress}% (${p.completed}/${p.total})`;
    }, interval);
  },

  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
};
