// 进度条管理模块
// 功能：创建和更新进度条

export const ProgressBar = {
  create(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const progress = document.createElement('div');
    progress.className = 'bqg-progress';

    const bar = document.createElement('div');
    bar.className = 'bqg-progress-bar';
    bar.style.width = '0%';
    bar.textContent = '0%';

    progress.appendChild(bar);
    container.appendChild(progress);

    return { progress, bar };
  },

  update(bar, percent, text) {
    if (!bar) return;
    bar.style.width = `${percent}%`;
    bar.textContent = text || `${percent}%`;
  },

  setState(bar, state) {
    if (!bar) return;
    bar.classList.remove('warning', 'error');
    if (state) bar.classList.add(state);
  },

  complete(bar, text) {
    this.update(bar, 100, text || '100%');
  }
};
