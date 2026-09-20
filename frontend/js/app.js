/* ============================================
   app.js —— 路由与全局状态
   路由：基于 # 锚点（hash）切换页面
   状态灯：定时探测后台连通性
   ============================================ */

/* ---------- 路由 ---------- */

// hash 路由 → 页面 ID 映射（与导航 Tab 一一对应）
const ROUTES = ['notes', 'study', 'materials', 'quiz', 'progress', 'reports'];
const DEFAULT_ROUTE = 'notes';

function getCurrentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(hash) ? hash : DEFAULT_ROUTE;
}

function showPage(route) {
  // 切换页面显示
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === route);
  });

  // 高亮当前 Tab
  document.querySelectorAll('.nav-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });
}

function handleRouteChange() {
  const route = getCurrentRoute();
  // 纠正非法 hash 到默认页
  if (location.hash !== '#/' + route) {
    location.replace('#/' + route);
    return; // replace 会再次触发 hashchange
  }
  showPage(route);
}

window.addEventListener('hashchange', handleRouteChange);

/* ---------- 后台连接状态灯 ---------- */

// 用需求文档中定义的轻量接口探测连通性（暂无专用健康检查接口）
const STATUS_CHECK_INTERVAL = 10000; // 10 秒

function setStatus(connected) {
  const dot = document.getElementById('status-dot');
  dot.classList.toggle('connected', connected);
  dot.classList.toggle('disconnected', !connected);
  dot.title = connected ? '后台已连接' : '后台未连接';
}

async function checkBackend() {
  try {
    await api.getOverview();
    setStatus(true);
  } catch (e) {
    setStatus(false);
  }
}

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  handleRouteChange();
  checkBackend();
  setInterval(checkBackend, STATUS_CHECK_INTERVAL);
});
