/* ============================================
   materials.js —— "资料库"页逻辑
   接口：POST /api/materials/upload、GET /api/materials、
         POST /api/materials/:id/retry、DELETE /api/materials/:id
   ============================================ */

const materialsEls = {
  zone: document.getElementById('upload-zone'),
  fileInput: document.getElementById('material-file-input'),
  list: document.getElementById('material-list'),
};

const ALLOWED_EXT = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'md', 'txt'];
const STATUS_TEXT = { parsing: '解析中', ready: '完成', failed: '失败' };
const STATUS_CLASS = { parsing: 'badge-parsing', ready: 'badge-ready', failed: 'badge-failed' };

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ---------- 列表 ---------- */

async function loadMaterials() {
  try {
    const data = await api.listMaterials({ page: 1, page_size: 100 });
    renderList(data.list || []);
  } catch (e) {
    materialsEls.list.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '加载失败：' + e.message;
    materialsEls.list.appendChild(tip);
  }
}

function renderList(list) {
  materialsEls.list.innerHTML = '';

  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'materials-empty';
    tip.textContent = '暂无资料，从上方拖入或点击上传';
    materialsEls.list.appendChild(tip);
    return;
  }

  // 表头
  const header = document.createElement('div');
  header.className = 'material-row material-header';
  ['文件名', '类型', '大小', '状态', '操作'].forEach((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    header.appendChild(span);
  });
  materialsEls.list.appendChild(header);

  list.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'material-row';

    const name = document.createElement('span');
    name.className = 'material-name';
    name.textContent = m.filename;
    name.title = m.filename;

    const type = document.createElement('span');
    type.className = 'tag';
    type.textContent = (m.file_type || '').toUpperCase();

    const size = document.createElement('span');
    size.className = 'material-secondary';
    size.textContent = formatSize(m.size);

    const status = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (STATUS_CLASS[m.status] || '');
    badge.textContent = STATUS_TEXT[m.status] || m.status;
    status.appendChild(badge);

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    if (m.status === 'failed') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-primary btn-sm';
      retryBtn.textContent = '重试';
      retryBtn.addEventListener('click', () => retryMaterial(m.id));
      actions.appendChild(retryBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary btn-sm';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteMaterial(m.id, m.filename));
    actions.appendChild(delBtn);

    row.appendChild(name);
    row.appendChild(type);
    row.appendChild(size);
    row.appendChild(status);
    row.appendChild(actions);
    materialsEls.list.appendChild(row);
  });
}

/* ---------- 上传 ---------- */

async function uploadFiles(files) {
  for (const file of files) {
    if (!ALLOWED_EXT.includes(extOf(file.name))) {
      toast('「' + file.name + '」格式不支持，仅限 PDF / PPT / Word / Markdown / TXT');
      continue;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.uploadMaterial(fd);
      toast('「' + file.name + '」上传成功，开始解析');
    } catch (e) {
      toast('「' + file.name + '」上传失败：' + e.message);
    }
  }
  loadMaterials();
}

/* ---------- 重试 / 删除 ---------- */

async function retryMaterial(id) {
  try {
    await api.retryMaterial(id);
    toast('已重新发起解析');
    loadMaterials();
  } catch (e) {
    toast('重试失败：' + e.message);
  }
}

async function deleteMaterial(id, filename) {
  if (!confirm('确定删除资料「' + filename + '」吗？其全部分块与向量将一并删除。')) return;
  try {
    await api.deleteMaterial(id);
    toast('已删除「' + filename + '」');
    loadMaterials();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  // 点击上传
  materialsEls.zone.addEventListener('click', () => materialsEls.fileInput.click());
  materialsEls.fileInput.addEventListener('change', () => {
    uploadFiles(materialsEls.fileInput.files);
    materialsEls.fileInput.value = '';
  });

  // 拖拽上传
  materialsEls.zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    materialsEls.zone.classList.add('dragover');
  });
  materialsEls.zone.addEventListener('dragleave', () => materialsEls.zone.classList.remove('dragover'));
  materialsEls.zone.addEventListener('drop', (e) => {
    e.preventDefault();
    materialsEls.zone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });

  // 存在"解析中"资料时定时刷新状态
  setInterval(() => {
    if (materialsEls.list.querySelector('.badge-parsing')) loadMaterials();
  }, 5000);

  loadMaterials();
});
