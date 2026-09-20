/* ============================================
   notes.js —— 记笔记页面逻辑
   左侧目录（按学习日期分组）+ 右侧编辑器 + 保存/取消
   接口：POST/GET/PUT/DELETE /api/notes（见功能需求文档二）
   ============================================ */

const notesState = {
  currentId: null,           // 当前编辑的笔记 ID，null 表示新建
  collapsedDates: new Set(), // 收起的日期分组
};

const notesEls = {
  tree: document.getElementById('notes-tree'),
  newBtn: document.getElementById('note-new-btn'),
  title: document.getElementById('note-title'),
  date: document.getElementById('note-date'),
  content: document.getElementById('note-content'),
  saveBtn: document.getElementById('note-save-btn'),
  cancelBtn: document.getElementById('note-cancel-btn'),
  imageBtn: document.getElementById('insert-image-btn'),
  imageInput: document.getElementById('image-file-input'),
  tableBtn: document.getElementById('insert-table-btn'),
  tablePopover: document.getElementById('table-popover'),
  tableRows: document.getElementById('table-rows'),
  tableCols: document.getElementById('table-cols'),
  tableConfirm: document.getElementById('table-insert-confirm'),
};

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- 左侧目录 ---------- */

async function loadNoteList() {
  try {
    const data = await api.listNotes({ page: 1, page_size: 100 });
    renderTree(data.list || []);
  } catch (e) {
    notesEls.tree.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'notes-empty';
    tip.textContent = '加载失败：' + e.message;
    notesEls.tree.appendChild(tip);
  }
}

function renderTree(list) {
  notesEls.tree.innerHTML = '';

  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'notes-empty';
    tip.textContent = '暂无笔记，点击右上角"新增笔记"';
    notesEls.tree.appendChild(tip);
    return;
  }

  // 按学习日期分组，日期倒序（最新的在上面）
  const groups = {};
  list.forEach((n) => {
    (groups[n.study_date] = groups[n.study_date] || []).push(n);
  });
  const dates = Object.keys(groups).sort().reverse();

  dates.forEach((date) => {
    const collapsed = notesState.collapsedDates.has(date);

    const group = document.createElement('div');
    group.className = 'note-group' + (collapsed ? ' collapsed' : '');

    // 分组头：点击收起/展开
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'note-group-header';
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = collapsed ? '▶' : '▼';
    header.appendChild(chevron);
    header.appendChild(document.createTextNode(date + '（' + groups[date].length + '）'));
    header.addEventListener('click', () => {
      if (notesState.collapsedDates.has(date)) notesState.collapsedDates.delete(date);
      else notesState.collapsedDates.add(date);
      group.classList.toggle('collapsed');
      chevron.textContent = group.classList.contains('collapsed') ? '▶' : '▼';
    });

    const items = document.createElement('div');
    items.className = 'note-group-items';
    groups[date].forEach((n) => {
      const item = document.createElement('div');
      item.className = 'note-item';
      item.dataset.id = n.id;
      item.textContent = n.title;
      item.title = '左键打开，右键删除';
      item.addEventListener('click', () => selectNote(n.id));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        deleteNote(n.id);
      });
      items.appendChild(item);
    });

    group.appendChild(header);
    group.appendChild(items);
    notesEls.tree.appendChild(group);
  });

  highlightActive(notesState.currentId);
}

function highlightActive(id) {
  notesEls.tree.querySelectorAll('.note-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.id) === id);
  });
}

/* ---------- 编辑区 ---------- */

function newNote() {
  notesState.currentId = null;
  notesEls.title.value = '';
  notesEls.date.value = todayStr();
  notesEls.content.innerHTML = '';
  highlightActive(null);
  notesEls.title.focus();
}

async function selectNote(id) {
  try {
    const note = await api.getNote(id);
    notesState.currentId = note.id;
    notesEls.title.value = note.title;
    notesEls.date.value = note.study_date;
    notesEls.content.innerHTML = note.content;
    highlightActive(id);
  } catch (e) {
    toast('加载笔记失败：' + e.message);
  }
}

async function saveNote() {
  const title = notesEls.title.value.trim();
  const studyDate = notesEls.date.value;
  if (!title) return toast('请输入笔记标题');
  if (!studyDate) return toast('请选择学习日期');

  const payload = { title: title, content: notesEls.content.innerHTML, study_date: studyDate };
  try {
    if (notesState.currentId) {
      await api.updateNote(notesState.currentId, payload);
    } else {
      const data = await api.createNote(payload);
      notesState.currentId = data.id;
    }
    toast('保存成功');
    await loadNoteList();
  } catch (e) {
    toast('保存失败：' + e.message);
  }
}

async function cancelEdit() {
  if (notesState.currentId) {
    await selectNote(notesState.currentId); // 丢弃改动，恢复为已保存内容
  } else {
    newNote();
  }
}

async function deleteNote(id) {
  if (!confirm('确定删除这条笔记吗？删除后不可恢复。')) return;
  try {
    await api.deleteNote(id);
    toast('已删除');
    if (notesState.currentId === id) newNote();
    await loadNoteList();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

/* ---------- 工具栏 ---------- */

function insertHTML(html) {
  document.execCommand('insertHTML', false, html);
  notesEls.content.focus();
}

function bindToolbar() {
  // 标题层级 / 加粗 / 斜体 / 下划线
  document.querySelectorAll('#editor-toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // 保持编辑区选中状态
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
      notesEls.content.focus();
    });
  });

  // 插入图片：本地图片转 base64 嵌入正文（接口清单中无图片上传接口）
  notesEls.imageBtn.addEventListener('mousedown', (e) => e.preventDefault());
  notesEls.imageBtn.addEventListener('click', () => notesEls.imageInput.click());
  notesEls.imageInput.addEventListener('change', () => {
    const file = notesEls.imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement('img');
      img.src = reader.result;
      insertHTML(img.outerHTML);
      notesEls.imageInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  // 插入表格：点击"表格"弹出行列选择，确认后插入
  notesEls.tableBtn.addEventListener('mousedown', (e) => e.preventDefault());
  notesEls.tableBtn.addEventListener('click', () => {
    notesEls.tablePopover.hidden = !notesEls.tablePopover.hidden;
  });
  notesEls.tableConfirm.addEventListener('click', () => {
    const rows = Math.min(10, Math.max(1, Number(notesEls.tableRows.value) || 3));
    const cols = Math.min(10, Math.max(1, Number(notesEls.tableCols.value) || 3));
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td><br></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertHTML(html);
    notesEls.tablePopover.hidden = true;
  });
}

/* ---------- 轻提示 ---------- */

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  notesEls.newBtn.addEventListener('click', newNote);
  notesEls.saveBtn.addEventListener('click', saveNote);
  notesEls.cancelBtn.addEventListener('click', cancelEdit);
  bindToolbar();

  notesEls.date.value = todayStr();
  loadNoteList();
});
