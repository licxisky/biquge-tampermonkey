// Toast 通知管理模块
// 功能：显示各种通知消息

export const ToastManager = {
  show(msg, type = 'success', duration = 2500) {
    const toast = document.createElement('div');
    toast.className = `bqg-toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 320);
    }, duration);
  },

  success(msg, duration) { this.show(msg, 'success', duration); },
  error(msg, duration) { this.show(msg, 'error', duration); },
  info(msg, duration) { this.show(msg, 'info', duration); },
  warn(msg, duration) { this.show(msg, 'warn', duration); }
};
