/* ============================================
   study.js —— "学习"页（聊资料）逻辑
   接口：POST /api/chat、GET /api/chat/sessions、GET /api/chat/sessions/:id/messages
   ============================================ */

const chatState = {
  sessionId: null,   // 当前会话 ID，null 表示新对话
  sending: false,    // 是否正在等待 AI 回复
};

const studyEls = {
  historyList: document.getElementById('chat-history-list'),
  materialSelect: document.getElementById('chat-material-select'),
  newBtn: document.getElementById('chat-new-btn'),
  messages: document.getElementById('chat-messages'),
  welcome: document.getElementById('chat-welcome'),
  input: document.getElementById('chat-input'),
  sendBtn: document.getElementById('chat-send-btn'),
};

/* ---------- 轻量 Markdown 渲染（标题/列表/代码块/粗斜体） ---------- */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderMarkdown(md) {
  let text = escapeHtml(md);

  // 先摘出代码块，避免块内内容被当作 Markdown 处理
  const codeBlocks = [];
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
  });

  const lines = text.split('\n');
  let html = '';
  let listType = null;
  const closeList = () => {
    if (listType) { html += '</' + listType + '>'; listType = null; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^\u0000CB\d+\u0000$/.test(line)) { closeList(); html += line; continue; }
    if (!line) { closeList(); continue; }

    let m;
    if ((m = line.match(/^###\s+(.+)/)))      { closeList(); html += '<h3>' + renderInline(m[1]) + '</h3>'; }
    else if ((m = line.match(/^##\s+(.+)/)))  { closeList(); html += '<h2>' + renderInline(m[1]) + '</h2>'; }
    else if ((m = line.match(/^#\s+(.+)/)))   { closeList(); html += '<h1>' + renderInline(m[1]) + '</h1>'; }
    else if ((m = line.match(/^[-*]\s+(.+)/))) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += '<li>' + renderInline(m[1]) + '</li>';
    }
    else if ((m = line.match(/^\d+\.\s+(.+)/))) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += '<li>' + renderInline(m[1]) + '</li>';
    }
    else { closeList(); html += '<p>' + renderInline(line) + '</p>'; }
  }
  closeList();

  return html.replace(/\u0000CB(\d+)\u0000/g, (m, i) => codeBlocks[i]);
}

/* ---------- 消息渲染 ---------- */

function scrollToBottom() {
  studyEls.messages.scrollTop = studyEls.messages.scrollHeight;
}

function updateWelcome() {
  studyEls.welcome.style.display = studyEls.messages.querySelector('.msg') ? 'none' : '';
}

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.textContent = text; // 用户输入按纯文本显示，防注入
  studyEls.messages.appendChild(div);
  updateWelcome();
  scrollToBottom();
}

function appendAiMessage(answer, citations) {
  const div = document.createElement('div');
  div.className = 'msg msg-ai';

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = renderMarkdown(answer);
  div.appendChild(body);

  // 引用来源折叠区（无引用则不显示）
  if (citations && citations.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cite-toggle';
    toggle.textContent = '▸ 引用来源（' + citations.length + '）';

    const list = document.createElement('div');
    list.className = 'cite-list';
    list.hidden = true;
    citations.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'cite-item';
      const file = document.createElement('div');
      file.className = 'cite-file';
      file.textContent = c.filename;
      const snippet = document.createElement('div');
      snippet.className = 'cite-snippet';
      snippet.textContent = c.snippet;
      item.appendChild(file);
      item.appendChild(snippet);
      list.appendChild(item);
    });

    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      toggle.textContent = (list.hidden ? '▸' : '▾') + ' 引用来源（' + citations.length + '）';
    });

    div.appendChild(toggle);
    div.appendChild(list);
  }

  studyEls.messages.appendChild(div);
  updateWelcome();
  scrollToBottom();
}

function showThinking() {
  const div = document.createElement('div');
  div.className = 'msg msg-ai msg-thinking';
  div.id = 'chat-thinking';
  div.innerHTML = '正在思考<span class="thinking-dots"><span></span><span></span><span></span></span>';
  studyEls.messages.appendChild(div);
  scrollToBottom();
}

function removeThinking() {
  const t = document.getElementById('chat-thinking');
  if (t) t.remove();
}

/* ---------- 资料下拉框 ---------- */

async function loadMaterialOptions() {
  try {
    const data = await api.listMaterials({ page: 1, page_size: 100 });
    (data.list || []).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.filename + (m.status === 'ready' ? '' : '（' + (m.status === 'parsing' ? '解析中' : '解析失败') + '）');
      studyEls.materialSelect.appendChild(opt);
    });
  } catch (e) {
    // 后台未启动时下拉框只保留默认选项
  }
}

function selectedMaterialIds() {
  const v = studyEls.materialSelect.value;
  return v ? [Number(v)] : [];
}

/* ---------- 历史对话 ---------- */

async function loadHistory() {
  try {
    const data = await api.listChatSessions({ page: 1, page_size: 100 });
    renderChatHistory(data.list || []);
  } catch (e) {
    studyEls.historyList.innerHTML = '';
    const tip = document.createElement('div');
    tip.className = 'history-empty';
    tip.textContent = '历史加载失败：' + e.message;
    studyEls.historyList.appendChild(tip);
  }
}

function renderChatHistory(list) {
  studyEls.historyList.innerHTML = '';
  if (!list.length) {
    const tip = document.createElement('div');
    tip.className = 'history-empty';
    tip.textContent = '暂无历史对话';
    studyEls.historyList.appendChild(tip);
    return;
  }
  list.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'history-item' + (s.id === chatState.sessionId ? ' active' : '');
    item.dataset.id = s.id;
    item.textContent = s.title;
    item.title = s.title;
    item.addEventListener('click', () => loadSession(s.id));
    item.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      deleteChatSessionItem(s.id, s.title);
    });
    studyEls.historyList.appendChild(item);
  });
}

async function deleteChatSessionItem(id, title) {
  if (!confirm('确定删除对话「' + (title || '未命名') + '」吗？\n删除后其中的聊天记录将一并清除，不可恢复。')) return;
  try {
    await api.deleteChatSession(id);
    toast('对话已删除');
    // 删的是当前打开的会话 → 清空聊天区回到新对话状态
    if (chatState.sessionId === id) {
      chatState.sessionId = null;
      studyEls.messages.querySelectorAll('.msg').forEach((el) => el.remove());
      updateWelcome();
    }
    loadHistory();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

async function loadSession(id) {
  try {
    const data = await api.listChatMessages(id);
    chatState.sessionId = id;
    studyEls.messages.querySelectorAll('.msg').forEach((el) => el.remove());
    (data.list || []).forEach((m) => {
      if (m.role === 'user') appendUserMessage(m.content);
      else appendAiMessage(m.content, m.citations || []);
    });
    updateWelcome();
    loadHistory();
  } catch (e) {
    toast('加载历史对话失败：' + e.message);
  }
}

function newChat() {
  chatState.sessionId = null;
  studyEls.messages.querySelectorAll('.msg').forEach((el) => el.remove());
  updateWelcome();
  loadHistory();
  studyEls.input.focus();
}

/* ---------- 发送 ---------- */

function setSending(sending) {
  chatState.sending = sending;
  studyEls.input.disabled = sending;
  studyEls.sendBtn.disabled = sending;
}

async function sendMessage() {
  const text = studyEls.input.value.trim();
  if (!text || chatState.sending) return;

  appendUserMessage(text);
  studyEls.input.value = '';
  setSending(true);
  showThinking();

  try {
    const data = await api.chat({
      question: text,
      material_ids: selectedMaterialIds(),
      session_id: chatState.sessionId || undefined,
    });
    removeThinking();
    chatState.sessionId = data.session_id;
    appendAiMessage(data.answer, data.citations || []);
    loadHistory(); // 新会话出现在左侧历史列表
  } catch (e) {
    removeThinking();
    toast('发送失败：' + e.message);
  } finally {
    setSending(false);
    studyEls.input.focus();
  }
}

/* ---------- 初始化 ---------- */

document.addEventListener('DOMContentLoaded', () => {
  studyEls.newBtn.addEventListener('click', newChat);
  studyEls.sendBtn.addEventListener('click', sendMessage);

  studyEls.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  updateWelcome();
  loadMaterialOptions();
  loadHistory();
});
