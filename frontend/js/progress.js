/* ============================================
   progress.js —— "进度"页逻辑
   接口：GET /api/progress/overview、GET /api/progress/knowledge-points、
         GET /api/materials、GET/PUT /api/materials/:id/note
   ============================================ */

const progressEls = {
  statCards: document.getElementById('progress-stat-cards'),
  radar: document.getElementById('progress-radar'),
  kpList: document.getElementById('kp-list'),
  weakList: document.getElementById('weak-list'),
  notes: document.getElementById('material-notes'),
};

const MASTERY_TEXT = { mastered: '掌握', weak: '薄弱', unknown: '待巩固' };
const MASTERY_CLASS = { mastered: 'badge-ready', weak: 'badge-failed', unknown: 'badge-parsing' };
const BAR_CLASS = { mastered: 'bar-mastered', weak: 'bar-weak', unknown: 'bar-unknown' };

/* ---------- 顶部统计卡片 ---------- */

function renderStatCards(overview, kps) {
  const mastered = kps.filter((k) => k.mastery === 'mastered').length;
  const weak = kps.filter((k) => k.mastery === 'weak').length;
  const avg = overview.avg_score_rate;

  const cards = [
    { label: '资料总数', value: overview.material_count ?? 0, cls: '' },
    { label: '已掌握知识点', value: mastered, cls: 'stat-good' },
    { label: '测验次数', value: overview.quiz_count ?? 0, cls: '' },
    { label: '平均分', value: avg === null || avg === undefined ? '—' : Math.round(avg * 100) + '%', cls: '' },
    { label: '薄弱知识点', value: weak, cls: weak > 0 ? 'stat-bad' : '' },
  ];

  progressEls.statCards.innerHTML = '';
  cards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card stat-card';
    const num = document.createElement('div');
    num.className = 'stat-num ' + c.cls;
    num.textContent = c.value;
    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = c.label;
    card.appendChild(num);
    card.appendChild(label);
    progressEls.statCards.appendChild(card);
  });
}

/* ---------- 雷达图（纯 SVG，无依赖） ---------- */

function renderRadar(kps) {
  if (kps.length < 3) {
    progressEls.radar.innerHTML = '<div class="radar-empty">知识点不足 3 个，暂无法绘制雷达图，继续做测评后自动生成</div>';
    return;
  }

  const C = 160;        // 圆心
  const R = 100;        // 半径
  const N = kps.length;

  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const fmt = (n) => Number(n.toFixed(1));

  let svg = '<svg viewBox="0 0 320 320" width="100%">';

  // 网格环（25% / 50% / 75% / 100%）
  [0.25, 0.5, 0.75, 1].forEach((level) => {
    const points = kps.map((_, i) => pt(i, R * level).map(fmt).join(',')).join(' ');
    svg += '<polygon points="' + points + '" fill="none" stroke="#e5e7eb"/>';
  });

  // 轴线 + 知识点名
  kps.forEach((kp, i) => {
    const [x, y] = pt(i, R);
    svg += '<line x1="' + C + '" y1="' + C + '" x2="' + fmt(x) + '" y2="' + fmt(y) + '" stroke="#e5e7eb"/>';
    const [lx, ly] = pt(i, R + 26);
    svg += '<text x="' + fmt(lx) + '" y="' + fmt(ly) + '" text-anchor="middle" dominant-baseline="middle" ' +
      'font-size="11" fill="#6b7280">' + escapeHtml(kp.name) + '</text>';
  });

  // 数据多边形 + 顶点
  const dataPoints = kps.map((kp, i) => pt(i, R * (kp.correct_rate ?? 0)).map(fmt).join(',')).join(' ');
  svg += '<polygon points="' + dataPoints + '" fill="rgba(37,99,235,0.15)" stroke="#2563eb" stroke-width="2"/>';
  kps.forEach((kp, i) => {
    const [x, y] = pt(i, R * (kp.correct_rate ?? 0));
    svg += '<circle cx="' + fmt(x) + '" cy="' + fmt(y) + '" r="3.5" fill="#2563eb"/>';
  });

  progressEls.radar.innerHTML = svg + '</svg>';
}

/* ---------- 知识点列表 ---------- */

function renderKpList(kps) {
  progressEls.kpList.innerHTML = '';
  if (!kps.length) {
    progressEls.kpList.innerHTML = '<div class="radar-empty">暂无知识点数据，做一次测评后自动生成</div>';
    return;
  }
  // 薄弱的排前面，其余按正确率升序
  const sorted = [...kps].sort((a, b) => {
    const rank = { weak: 0, unknown: 1, mastered: 2 };
    return rank[a.mastery] - rank[b.mastery] || a.correct_rate - b.correct_rate;
  });

  sorted.forEach((kp) => {
    const row = document.createElement('div');
    row.className = 'kp-row';

    const head = document.createElement('div');
    head.className = 'kp-head';
    const name = document.createElement('span');
    name.className = 'kp-name';
    name.textContent = kp.name;
    const tag = document.createElement('span');
    tag.className = 'badge ' + (MASTERY_CLASS[kp.mastery] || '');
    tag.textContent = MASTERY_TEXT[kp.mastery] || kp.mastery;
    head.appendChild(name);
    head.appendChild(tag);
    row.appendChild(head);

    const bar = document.createElement('div');
    bar.className = 'kp-bar';
    const fill = document.createElement('div');
    fill.className = 'kp-bar-fill ' + (BAR_CLASS[kp.mastery] || '');
    const pct = Math.round((kp.correct_rate ?? 0) * 100);
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);

    const rate = document.createElement('div');
    rate.className = 'kp-rate';
    rate.textContent = '正确率 ' + pct + '%（' + kp.correct_count + '/' + kp.quiz_count + '）';
    row.appendChild(rate);

    progressEls.kpList.appendChild(row);
  });
}

/* ---------- 薄弱知识点 ---------- */

function renderWeakList(kps) {
  const weak = kps.filter((k) => k.mastery === 'weak');
  progressEls.weakList.innerHTML = '';
  if (!weak.length) {
    const tip = document.createElement('span');
    tip.className = 'weak-empty';
    tip.textContent = '暂无薄弱知识点，继续保持';
    progressEls.weakList.appendChild(tip);
    return;
  }
  weak.forEach((k) => {
    const chip = document.createElement('span');
    chip.className = 'weak-chip';
    chip.textContent = k.name + '（正确率 ' + Math.round((k.correct_rate ?? 0) * 100) + '%）';
    progressEls.weakList.appendChild(chip);
  });
}

/* ---------- 资料笔记（自动保存 + 长内容折叠） ---------- */

const noteTimers = {}; // material_id -> 防抖定时器

async function loadMaterialNotes() {
  try {
    const data = await api.listMaterials({ page: 1, page_size: 100 });
    renderNoteCards(data.list || []);
  } catch (e) {
    progressEls.notes.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '资料加载失败：' + e.message;
    progressEls.notes.appendChild(tip);
  }
}

function renderNoteCards(list) {
  progressEls.notes.innerHTML = '';
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '暂无资料，先到"资料库"上传';
    progressEls.notes.appendChild(tip);
    return;
  }

  list.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'card note-card';

    const head = document.createElement('div');
    head.className = 'note-card-head';
    const name = document.createElement('span');
    name.className = 'material-name';
    name.textContent = m.filename;
    name.title = m.filename;
    const type = document.createElement('span');
    type.className = 'tag';
    type.textContent = (m.file_type || '').toUpperCase();
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-secondary btn-sm note-toggle';
    toggle.textContent = '收起';
    head.appendChild(name);
    head.appendChild(type);
    head.appendChild(toggle);
    card.appendChild(head);

    const ta = document.createElement('textarea');
    ta.className = 'textarea note-textarea';
    ta.placeholder = '记录这份资料的要点、疑问...';
    card.appendChild(ta);

    const status = document.createElement('div');
    status.className = 'note-status';
    status.textContent = '尚未编辑';
    card.appendChild(status);

    // 长内容默认折叠（内部滚动），可展开
    if (ta.value.length > 200) collapse(true);

    function collapse(collapsed) {
      ta.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '展开' : '收起';
    }
    toggle.addEventListener('click', () => collapse(!ta.classList.contains('collapsed')));

    // 自动保存：输入停顿 1.5 秒后保存
    ta.addEventListener('input', () => {
      status.textContent = '编辑中...';
      clearTimeout(noteTimers[m.id]);
      noteTimers[m.id] = setTimeout(saveNote, 1500);
    });

    async function saveNote() {
      status.textContent = '保存中...';
      try {
        await api.saveMaterialNote(m.id, ta.value);
        status.textContent = '已自动保存 ' + new Date().toLocaleTimeString();
      } catch (e) {
        status.textContent = '保存失败：' + e.message;
      }
    }

    // 载入已有笔记
    (async () => {
      try {
        const note = await api.getMaterialNote(m.id);
        if (note && note.content) {
          ta.value = note.content;
          if (note.content.length > 200) collapse(true);
          status.textContent = '已自动保存 ' + (note.updated_at || '').replace('T', ' ').slice(0, 19);
        }
      } catch (e) {
        status.textContent = '笔记加载失败：' + e.message;
      }
    })();

    progressEls.notes.appendChild(card);
  });
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [overview, kpData] = await Promise.all([api.getOverview(), api.getKnowledgePoints()]);
    const kps = kpData.list || [];
    renderStatCards(overview, kps);
    renderRadar(kps);
    renderKpList(kps);
    renderWeakList(kps);
  } catch (e) {
    progressEls.statCards.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card stat-card';
    card.textContent = '进度数据加载失败：' + e.message;
    progressEls.statCards.appendChild(card);
    progressEls.radar.innerHTML = '';
    progressEls.kpList.innerHTML = '';
    progressEls.weakList.innerHTML = '';
  }
  loadMaterialNotes();
});
