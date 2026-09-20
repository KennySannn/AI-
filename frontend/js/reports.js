/* ============================================
   reports.js —— "报告"页逻辑（生成学习周报）
   接口：POST /api/reports/weekly/generate、GET /api/reports/weekly、
         GET /api/reports/weekly/:id
   复用 study.js 的 renderMarkdown / escapeHtml、notes.js 的 toast
   ============================================ */

const reportState = {
  rangeMode: 'week',   // week | custom
  current: null,       // 当前展示的报告 {week_start, week_end, content}
  generating: false,
};

const reportsEls = {
  rangeOptions: document.getElementById('report-range-options'),
  dateInputs: document.getElementById('report-date-inputs'),
  start: document.getElementById('report-start'),
  end: document.getElementById('report-end'),
  generateBtn: document.getElementById('report-generate-btn'),
  generating: document.getElementById('report-generating'),
  view: document.getElementById('report-view'),
  viewSub: document.getElementById('report-view-sub'),
  downloadBtn: document.getElementById('report-download-btn'),
  content: document.getElementById('report-content'),
  history: document.getElementById('report-history'),
};

function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function thisWeekRange() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [fmtDate(monday), fmtDate(sunday)];
}

/* ---------- 时间范围选择 ---------- */

function initRangeOptions() {
  const [mon, sun] = thisWeekRange();
  reportsEls.start.value = mon;
  reportsEls.end.value = sun;

  reportsEls.rangeOptions.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportsEls.rangeOptions.querySelectorAll('.chip').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
      reportState.rangeMode = btn.dataset.range;
      reportsEls.dateInputs.hidden = reportState.rangeMode !== 'custom';
    });
  });
}

function currentRange() {
  if (reportState.rangeMode === 'week') return thisWeekRange();
  return [reportsEls.start.value, reportsEls.end.value];
}

/* ---------- 生成报告 ---------- */

async function generateReport() {
  if (reportState.generating) return;

  const [start, end] = currentRange();
  if (!start || !end) return toast('请选择开始和结束日期');
  if (start > end) return toast('开始日期不能晚于结束日期');

  reportState.generating = true;
  reportsEls.generateBtn.disabled = true;
  reportsEls.generating.hidden = false;

  try {
    const data = await api.generateWeeklyReport(start, end);
    const detail = await api.getWeeklyReport(data.report_id);
    renderReport(detail);
    loadReportHistory();
  } catch (e) {
    toast('生成报告失败：' + e.message);
  } finally {
    reportState.generating = false;
    reportsEls.generateBtn.disabled = false;
    reportsEls.generating.hidden = true;
  }
}

function renderReport(detail) {
  reportState.current = detail;
  reportsEls.view.hidden = false;
  reportsEls.viewSub.textContent = detail.week_start + ' 至 ' + detail.week_end;
  reportsEls.content.innerHTML = renderMarkdown(detail.content || '（报告内容为空）');
  reportsEls.view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 下载 ---------- */

function downloadReport() {
  const r = reportState.current;
  if (!r) return;
  const blob = new Blob([r.content || ''], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '学习周报_' + r.week_start + '_' + r.week_end + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 历史报告 ---------- */

async function loadReportHistory() {
  try {
    const data = await api.listWeeklyReports({ page: 1, page_size: 50 });
    renderReportHistory(data.list || []);
  } catch (e) {
    reportsEls.history.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '历史报告加载失败：' + e.message;
    reportsEls.history.appendChild(tip);
  }
}

function renderReportHistory(list) {
  reportsEls.history.innerHTML = '';
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '暂无历史报告，先在上方生成一份';
    reportsEls.history.appendChild(tip);
    return;
  }
  list.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'quiz-history-row';

    const name = document.createElement('span');
    name.className = 'material-name';
    name.textContent = '学习周报 #' + r.id;

    const range = document.createElement('span');
    range.className = 'material-secondary';
    range.textContent = r.week_start + ' 至 ' + r.week_end;

    const date = document.createElement('span');
    date.className = 'material-secondary';
    date.textContent = '生成于 ' + (r.created_at || '').replace('T', ' ').slice(0, 16);

    row.appendChild(name);
    row.appendChild(range);
    row.appendChild(date);
    row.addEventListener('click', async () => {
      try {
        const detail = await api.getWeeklyReport(r.id);
        renderReport(detail);
      } catch (e) {
        toast('加载报告失败：' + e.message);
      }
    });
    reportsEls.history.appendChild(row);
  });
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initRangeOptions();
  reportsEls.generateBtn.addEventListener('click', generateReport);
  reportsEls.downloadBtn.addEventListener('click', downloadReport);
  loadReportHistory();
});
