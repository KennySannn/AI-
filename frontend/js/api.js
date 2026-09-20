/* ============================================
   api.js —— 请求封装
   约定（见《功能需求文档》二）：
   - 前缀 /api，响应统一包裹 { code, msg, data }
   - code === 0 为成功，data 为业务数据；否则抛出错误
   ============================================ */

const API_BASE = '/api';

/**
 * 通用请求方法
 * @param {string} path - 接口路径，如 '/notes'（不含 /api 前缀）
 * @param {object} [options] - fetch 配置 { method, body, isForm }
 *   isForm 为 true 时 body 为 FormData，不设 Content-Type
 * @returns {Promise<any>} 返回响应中的 data 字段
 */
async function request(path, options = {}) {
  const { method = 'GET', body, isForm = false } = options;

  const fetchOptions = { method };
  if (body !== undefined) {
    if (isForm) {
      fetchOptions.body = body; // FormData：浏览器自动设 multipart 边界
    } else {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const res = await fetch(API_BASE + path, fetchOptions);
  const json = await res.json();

  if (json.code !== 0) {
    throw new Error(json.msg || '请求失败');
  }
  return json.data;
}

/* 各模块接口（与《功能需求文档》二一一对应） */
const api = {
  // 记笔记
  createNote: (data) => request('/notes', { method: 'POST', body: data }),
  listNotes: (params) => request('/notes?' + new URLSearchParams(params)),
  getNote: (id) => request(`/notes/${id}`),
  updateNote: (id, data) => request(`/notes/${id}`, { method: 'PUT', body: data }),
  deleteNote: (id) => request(`/notes/${id}`, { method: 'DELETE' }),

  // 传资料
  uploadMaterial: (formData) => request('/materials/upload', { method: 'POST', body: formData, isForm: true }),
  listMaterials: (params) => request('/materials?' + new URLSearchParams(params)),
  retryMaterial: (id) => request(`/materials/${id}/retry`, { method: 'POST' }),
  deleteMaterial: (id) => request(`/materials/${id}`, { method: 'DELETE' }),

  // 聊资料
  chat: (data) => request('/chat', { method: 'POST', body: data }),
  listChatSessions: (params) => request('/chat/sessions?' + new URLSearchParams(params)),
  listChatMessages: (sessionId) => request(`/chat/sessions/${sessionId}/messages`),
  deleteChatSession: (sessionId) => request(`/chat/sessions/${sessionId}`, { method: 'DELETE' }),

  // 做测评
  generateQuiz: (data) => request('/quizzes/generate', { method: 'POST', body: data }),
  submitQuiz: (id, answers, durationSeconds) => request(`/quizzes/${id}/submit`, { method: 'POST', body: { answers, duration_seconds: durationSeconds } }),
  getQuiz: (id) => request(`/quizzes/${id}`),
  listQuizzes: (params) => request('/quizzes?' + new URLSearchParams(params)),

  // 看进度
  getOverview: () => request('/progress/overview'),
  getKnowledgePoints: () => request('/progress/knowledge-points'),

  // 资料笔记（自动保存）
  getMaterialNote: (id) => request(`/materials/${id}/note`),
  saveMaterialNote: (id, content) => request(`/materials/${id}/note`, { method: 'PUT', body: { content } }),

  // 出周报
  generateWeeklyReport: (weekStart, weekEnd) => request('/reports/weekly/generate', { method: 'POST', body: { week_start: weekStart, week_end: weekEnd } }),
  listWeeklyReports: (params) => request('/reports/weekly?' + new URLSearchParams(params)),
  getWeeklyReport: (id) => request(`/reports/weekly/${id}`),
};
