/* ============================================
   quiz.js —— "测评"页逻辑（三步：开始前 → 答题中 → 看结果）
   接口：POST /api/quizzes/generate、POST /api/quizzes/:id/submit、
         GET /api/quizzes/:id、GET /api/quizzes、GET /api/materials
   ============================================ */

const quizState = {
  step: 'setup',
  materialIds: [],       // 选中的资料
  count: 10,             // 总题数
  quizId: null,
  questions: [],         // 答题中的题目
  answers: {},           // question_id -> 用户答案
  startTs: 0,            // 开答时间戳
  elapsed: 0,            // 已用秒数
  timerId: null,
  submitting: false,
  generating: false,
};

const quizEls = {
  setup: document.getElementById('quiz-setup'),
  answering: document.getElementById('quiz-answering'),
  result: document.getElementById('quiz-result'),
  chips: document.getElementById('quiz-material-chips'),
  countOptions: document.getElementById('quiz-count-options'),
  startBtn: document.getElementById('quiz-start-btn'),
  generating: document.getElementById('quiz-generating'),
  progress: document.getElementById('quiz-progress'),
  timer: document.getElementById('quiz-timer'),
  questions: document.getElementById('quiz-questions'),
  grading: document.getElementById('quiz-grading'),
  quitBtn: document.getElementById('quiz-quit-btn'),
  submitBtn: document.getElementById('quiz-submit-btn'),
  ring: document.getElementById('score-ring'),
  resultStats: document.getElementById('result-stats'),
  resultQuestions: document.getElementById('result-questions'),
  againBtn: document.getElementById('quiz-again-btn'),
  history: document.getElementById('quiz-history'),
};

const TYPE_TEXT = { choice: '选择', judge: '判断', short: '简答' };
const DIFF_CLASS = { '简单': 'q-diff-easy', '中等': 'q-diff-mid', '较难': 'q-diff-hard' };
// 判断题固定选项（用户约定）：A=正确 B=错误
const JUDGE_OPTIONS = { 'A': '正确', 'B': '错误' };

// 后台返回的 options 可能是字符串（JSON 数组串），统一转成数组
function normalizeOptions(options) {
  if (Array.isArray(options)) return options;
  if (typeof options === 'string' && options.trim()) {
    try {
      const parsed = JSON.parse(options);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* 非合法 JSON，按无选项处理 */ }
  }
  return [];
}

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return m + ':' + s;
}

function showStep(step) {
  quizState.step = step;
  quizEls.setup.hidden = step !== 'setup';
  quizEls.answering.hidden = step !== 'answering';
  quizEls.result.hidden = step !== 'result';
}

/* ---------- 第一步：开始前 ---------- */

async function loadMaterialChips() {
  try {
    const data = await api.listMaterials({ page: 1, page_size: 100 });
    renderChips((data.list || []).filter((m) => m.status === 'ready'));
  } catch (e) {
    quizEls.chips.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '资料加载失败：' + e.message;
    quizEls.chips.appendChild(tip);
  }
}

function renderChips(list) {
  quizEls.chips.innerHTML = '';
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '暂无可用资料，请先到"资料库"上传并等待解析完成';
    quizEls.chips.appendChild(tip);
    return;
  }
  list.forEach((m) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = m.filename;
    chip.title = m.filename;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const id = Number(chip.dataset.id);
      const i = quizState.materialIds.indexOf(id);
      if (i === -1) quizState.materialIds.push(id);
      else quizState.materialIds.splice(i, 1);
    });
    chip.dataset.id = m.id;
    quizEls.chips.appendChild(chip);
  });
}

// 总题数 → 三种题型数量：选择约占一半，判断四分之一，简答其余
function splitCounts(total) {
  const choice = Math.ceil(total / 2);
  const judge = Math.floor(total / 4);
  return { choice_count: choice, judge_count: judge, short_count: total - choice - judge };
}

async function startQuiz() {
  if (quizState.generating) return;
  if (!quizState.materialIds.length) return toast('请先选择至少一份要测的资料');

  quizState.generating = true;
  quizEls.startBtn.disabled = true;
  quizEls.generating.hidden = false;

  try {
    const data = await api.generateQuiz({
      material_ids: quizState.materialIds,
      ...splitCounts(quizState.count),
    });
    quizState.quizId = data.quiz_id;
    quizState.questions = data.questions || [];
    quizState.answers = {};
    enterAnswering();
  } catch (e) {
    toast('出题失败：' + e.message);
  } finally {
    quizState.generating = false;
    quizEls.startBtn.disabled = false;
    quizEls.generating.hidden = true;
  }
}

/* ---------- 第二步：答题中 ---------- */

function enterAnswering() {
  showStep('answering');
  renderQuestions();
  updateProgress();

  quizState.startTs = Date.now();
  quizState.elapsed = 0;
  quizEls.timer.textContent = '用时 00:00';
  clearInterval(quizState.timerId);
  quizState.timerId = setInterval(() => {
    quizState.elapsed = Math.floor((Date.now() - quizState.startTs) / 1000);
    quizEls.timer.textContent = '用时 ' + fmtTime(quizState.elapsed);
  }, 1000);
}

function renderQuestions() {
  quizEls.questions.innerHTML = '';
  quizState.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'card question-card';

    // 头部：题型标签 + 难度标签
    const head = document.createElement('div');
    head.className = 'q-head';
    const typeTag = document.createElement('span');
    typeTag.className = 'tag q-type-' + q.type;
    typeTag.textContent = TYPE_TEXT[q.type] || q.type;
    head.appendChild(typeTag);
    if (q.difficulty) {
      const diff = document.createElement('span');
      diff.className = 'tag ' + (DIFF_CLASS[q.difficulty] || '');
      diff.textContent = q.difficulty;
      head.appendChild(diff);
    }
    const no = document.createElement('span');
    no.className = 'q-no';
    no.textContent = '第 ' + (idx + 1) + ' 题';
    head.appendChild(no);
    card.appendChild(head);

    const text = document.createElement('div');
    text.className = 'q-text';
    text.textContent = q.question;
    card.appendChild(text);

    if (q.type === 'choice') renderChoice(card, q);
    else if (q.type === 'judge') renderJudge(card, q);
    else renderShort(card, q);

    quizEls.questions.appendChild(card);
  });
}

function setAnswer(questionId, answer) {
  quizState.answers[questionId] = answer;
  updateProgress();
}

function renderChoice(card, q) {
  normalizeOptions(q.options).forEach((opt, i) => {
    const letter = 'ABCD'[i];
    // 用 button 而非 div：键盘 Tab 聚焦、Enter/Space 即可选中（原生触发 click）
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.textContent = opt;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      // 单选：先清掉同题其他选中态
      card.querySelectorAll('.option').forEach((el) => {
        el.classList.remove('selected');
        el.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      setAnswer(q.question_id, letter);
    });
    card.appendChild(btn);
  });
}

function renderJudge(card, q) {
  // 固定选项 A=正确 / B=错误，与后台判分规则对齐（提交时存选项文字）
  const wrap = document.createElement('div');
  wrap.className = 'judge-options';
  Object.keys(JUDGE_OPTIONS).forEach((letter) => {
    const label = JUDGE_OPTIONS[letter];
    // 用 button 而非 div：键盘 Tab 聚焦、Enter/Space 即可选中（原生触发 click）
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option judge-option';
    btn.textContent = letter + '. ' + label;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.option').forEach((el) => {
        el.classList.remove('selected');
        el.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      setAnswer(q.question_id, label);
    });
    wrap.appendChild(btn);
  });
  card.appendChild(wrap);
}

function renderShort(card, q) {
  const ta = document.createElement('textarea');
  ta.className = 'textarea short-answer';
  ta.placeholder = '在此输入你的答案...';
  ta.addEventListener('input', () => setAnswer(q.question_id, ta.value));
  card.appendChild(ta);
}

function updateProgress() {
  const answered = Object.keys(quizState.answers).filter((k) => quizState.answers[k] !== '' && quizState.answers[k] !== undefined).length;
  quizEls.progress.textContent = '已答 ' + answered + ' / ' + quizState.questions.length + ' 题';
}

async function submitQuiz() {
  if (quizState.submitting) return;
  const unanswered = quizState.questions.filter((q) => !quizState.answers[q.question_id]).length;
  if (unanswered && !confirm('还有 ' + unanswered + ' 题未作答，未答题将计 0 分，确定提交吗？')) return;

  quizState.submitting = true;
  quizEls.submitBtn.disabled = true;
  quizEls.quitBtn.disabled = true;
  quizEls.grading.hidden = false;
  clearInterval(quizState.timerId);

  const duration = quizState.elapsed || Math.floor((Date.now() - quizState.startTs) / 1000);

  try {
    await api.submitQuiz(quizState.quizId, quizState.questions.map((q) => ({
      question_id: q.question_id,
      answer: quizState.answers[q.question_id] || '',
    })), duration);

    // 提交成功后拉取完整详情（含标准答案与我的答案）
    const detail = await api.getQuiz(quizState.quizId);
    renderResult(detail, duration);
  } catch (e) {
    toast('提交失败：' + e.message);
    quizState.timerId = setInterval(() => {
      quizState.elapsed = Math.floor((Date.now() - quizState.startTs) / 1000);
      quizEls.timer.textContent = '用时 ' + fmtTime(quizState.elapsed);
    }, 1000);
  } finally {
    quizState.submitting = false;
    quizEls.submitBtn.disabled = false;
    quizEls.quitBtn.disabled = false;
    quizEls.grading.hidden = true;
  }
}

function quitQuiz() {
  if (!confirm('确定放弃本次测评吗？已答内容将不保存。')) return;
  clearInterval(quizState.timerId);
  showStep('setup');
  loadMaterialChips();
  loadQuizHistory();
}

/* ---------- 第三步：看结果 ---------- */

function renderResult(detail, durationSec) {
  showStep('result');

  const total = Number(detail.total_score) || 0;
  const full = Number(detail.full_score) || 0;
  const pct = full > 0 ? total / full : 0;
  const results = detail.results || [];
  const correct = results.filter((r) => r.is_correct).length;
  const wrong = results.length - correct;
  const duration = durationSec !== undefined ? durationSec : (detail.duration_seconds || 0);

  renderRing(pct, total, full);

  quizEls.resultStats.innerHTML = '';
  [['答对', correct + ' 题', 'stat-good'], ['答错', wrong + ' 题', 'stat-bad'], ['用时', fmtTime(duration), '']].forEach(([label, value, cls]) => {
    const row = document.createElement('div');
    row.className = 'result-stat-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'result-stat-value ' + cls;
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    quizEls.resultStats.appendChild(row);
  });

  renderResultQuestions(detail.questions || [], results);
  loadQuizHistory();
}

function renderRing(pct, total, full) {
  const R = 56;
  const C = 2 * Math.PI * R;
  quizEls.ring.innerHTML =
    '<svg width="140" height="140" viewBox="0 0 140 140">' +
    '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#e5e7eb" stroke-width="10"/>' +
    '<circle id="ring-arc" cx="70" cy="70" r="' + R + '" fill="none" stroke="#2563eb" stroke-width="10" ' +
    'stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" transform="rotate(-90 70 70)"/>' +
    '</svg>' +
    '<div class="ring-center"><div class="ring-score">' + total + '</div><div class="ring-full">/ ' + full + '</div></div>';

  // 动画：下一帧再设置目标偏移，触发 CSS 过渡
  const arc = document.getElementById('ring-arc');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      arc.style.strokeDashoffset = C * (1 - pct);
    });
  });
}

function renderResultQuestions(questions, results) {
  const resultMap = {};
  results.forEach((r) => { resultMap[r.question_id] = r; });

  quizEls.resultQuestions.innerHTML = '';
  questions.forEach((q, idx) => {
    const r = resultMap[q.question_id] || {};
    const full = Number(q.score) || 1;
    const got = Number(r.got_score) || 0;

    const card = document.createElement('div');
    card.className = 'card question-card result-question';

    // 头部：点击展开/收起
    const head = document.createElement('div');
    head.className = 'rq-head';
    const no = document.createElement('span');
    no.className = 'q-no';
    no.textContent = '第 ' + (idx + 1) + ' 题';
    const typeTag = document.createElement('span');
    typeTag.className = 'tag q-type-' + q.type;
    typeTag.textContent = TYPE_TEXT[q.type] || q.type;
    const score = document.createElement('span');
    score.className = 'q-score ' + (got >= full ? 'stat-good' : 'stat-bad');
    score.textContent = got + ' / ' + full + ' 分' + (got >= full ? ' ✓' : ' ✗');
    const arrow = document.createElement('span');
    arrow.className = 'rq-arrow';
    arrow.textContent = '▸';
    head.appendChild(no);
    head.appendChild(typeTag);
    head.appendChild(score);
    head.appendChild(arrow);
    card.appendChild(head);

    const text = document.createElement('div');
    text.className = 'q-text';
    text.textContent = q.question;
    card.appendChild(text);

    // 展开区：正确答案 / 我的答案 / AI 点评
    const body = document.createElement('div');
    body.className = 'rq-body';
    body.hidden = true;

    const answerText = formatAnswer(q);
    const userAnswerText = r.user_answer == null ? '（未作答）'
      : (q.type === 'judge' ? (r.user_answer === '对' || r.user_answer === '正确' ? '正确'
        : r.user_answer === '错' || r.user_answer === '错误' ? '错误' : r.user_answer)
      : r.user_answer);
    const rows = [
      ['正确答案', answerText, 'rq-answer'],
      ['我的答案', userAnswerText, ''],
      ['AI 点评', r.comment || '—', ''],
    ];
    rows.forEach(([label, value, cls]) => {
      const row = document.createElement('div');
      row.className = 'q-detail-row';
      const l = document.createElement('span');
      l.className = 'q-detail-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'q-detail-value ' + cls;
      v.textContent = value;
      row.appendChild(l);
      row.appendChild(v);
      body.appendChild(row);
    });
    card.appendChild(body);

    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      arrow.textContent = body.hidden ? '▸' : '▾';
    });

    quizEls.resultQuestions.appendChild(card);
  });
}

function formatAnswer(q) {
  if (q.type === 'choice') {
    const letter = q.answer;
    const opt = normalizeOptions(q.options).find((o) => o.indexOf(letter + '.') === 0);
    return opt ? letter + '（' + opt.slice(letter.length + 2) + '）' : letter;
  }
  if (q.type === 'judge') {
    // 后台标准答案统一存 对/错，展示为 正确/错误
    return q.answer === '对' ? '正确' : q.answer === '错' ? '错误' : q.answer;
  }
  return q.answer;
}

/* ---------- 历史测评记录 ---------- */

async function loadQuizHistory() {
  try {
    const data = await api.listQuizzes({ page: 1, page_size: 50 });
    renderQuizHistory(data.list || []);
  } catch (e) {
    quizEls.history.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '测评记录加载失败：' + e.message;
    quizEls.history.appendChild(tip);
  }
}

function renderQuizHistory(list) {
  quizEls.history.innerHTML = '';
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '暂无测评记录';
    quizEls.history.appendChild(tip);
    return;
  }
  list.forEach((qz) => {
    const row = document.createElement('div');
    row.className = 'quiz-history-row';

    const name = document.createElement('span');
    name.className = 'material-name';
    name.textContent = '测评 #' + qz.quiz_id;

    const score = document.createElement('span');
    score.className = 'material-secondary';
    score.textContent = '得分 ' + qz.total_score + ' / ' + qz.full_score;

    const time = document.createElement('span');
    time.className = 'material-secondary';
    time.textContent = '用时 ' + fmtTime(qz.duration_seconds || 0);

    const date = document.createElement('span');
    date.className = 'material-secondary';
    date.textContent = (qz.created_at || '').replace('T', ' ').slice(0, 16);

    row.appendChild(name);
    row.appendChild(score);
    row.appendChild(time);
    row.appendChild(date);
    row.addEventListener('click', async () => {
      try {
        const detail = await api.getQuiz(qz.quiz_id);
        renderResult(detail, detail.duration_seconds);
      } catch (e) {
        toast('加载测评详情失败：' + e.message);
      }
    });
    quizEls.history.appendChild(row);
  });
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  quizEls.countOptions.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      quizEls.countOptions.querySelectorAll('.chip').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
      quizState.count = Number(btn.dataset.count);
    });
  });

  quizEls.startBtn.addEventListener('click', startQuiz);
  quizEls.submitBtn.addEventListener('click', submitQuiz);
  quizEls.quitBtn.addEventListener('click', quitQuiz);
  quizEls.againBtn.addEventListener('click', () => {
    showStep('setup');
    loadMaterialChips();
  });

  loadMaterialChips();
});
