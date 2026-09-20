"""
routes/chat.py —— 聊资料接口（需求文档二·聊资料）
实现方式：不做向量检索。把提问拆成关键词，在所选资料的 chunks 里按命中度
捞出最相关的若干段落，连同提问与历史对话组装进 LLM 请求（系统提示词用
prompts.TUTOR_PROMPT）。
"""
import re
from datetime import datetime

from flask import Blueprint, current_app, request

from database import db, ok, err
from models import Material, Chunk, ChatSession, ChatMessage
from prompts import TUTOR_PROMPT
from llm_client import call_llm, LLMError

bp = Blueprint('chat', __name__)

TOP_K = 6          # 每次提问最多携带的相关分块数
SNIPPET_LEN = 150  # 引用来源展示的片段长度
HISTORY_LEN = 10   # 携带的最近历史消息条数
MAX_CONTEXT_CHARS = 24000  # 资料上下文总量上限


def _query_terms(question):
    """把提问拆成检索词：英文/数字词 + 中文的相邻二字组合。"""
    cleaned = re.sub(r'[^\w\u4e00-\u9fff]+', ' ', question.lower())
    tokens = [t for t in cleaned.split() if len(t) >= 2]
    terms = set(tokens)
    for t in tokens:
        if re.search(r'[\u4e00-\u9fff]', t):
            for i in range(len(t) - 1):
                terms.add(t[i:i + 2])
    return list(terms)[:40]


def _search_chunks(material_ids, question):
    """在指定资料的 ready 分块里按关键词命中度挑最相关的 TOP_K 块。
    无命中时回退为取各资料开头若干块。返回 [(Chunk, Material)]。
    """
    query = (Chunk.query
             .join(Material, Chunk.material_id == Material.id)
             .filter(Chunk.material_id.in_(material_ids), Material.status == 1)
             .order_by(Chunk.material_id, Chunk.chunk_index))
    chunks = query.all()
    if not chunks:
        return []

    materials = {m.id: m for m in Material.query.filter(Material.id.in_(material_ids))}

    terms = _query_terms(question)
    if terms:
        def score(chunk):
            content = chunk.content.lower()
            return sum(1 for t in terms if t in content)
        ranked = sorted(chunks, key=score, reverse=True)
        if score(ranked[0]) > 0:
            return [(c, materials[c.material_id]) for c in ranked[:TOP_K]]

    # 无命中：各资料轮流取开头块，保证覆盖
    by_material = {}
    for c in chunks:
        by_material.setdefault(c.material_id, []).append(c)
    picked = []
    for i in range(max(len(v) for v in by_material.values())):
        for mid in sorted(by_material):
            if i < len(by_material[mid]):
                picked.append(by_material[mid][i])
            if len(picked) >= TOP_K:
                break
        if len(picked) >= TOP_K:
            break
    return [(c, materials[c.material_id]) for c in picked]


@bp.route('/chat', methods=['POST'])
def chat():
    """POST /api/chat —— 提问
    入参: {question, material_ids: number[], session_id?: number}
    无 session_id 则新建会话；material_ids 为空 = 普通对话（不引用资料）
    返回: {session_id, answer, citations:[{material_id, filename, chunk_id, snippet}]}
    """
    body = request.get_json(silent=True) or {}
    question = (body.get('question') or '').strip()
    if not question:
        return err('提问不能为空')
    material_ids = body.get('material_ids') or []

    session_id = body.get('session_id')
    if session_id:
        session = db.session.get(ChatSession, session_id)
        if session is None:
            return err('会话不存在', code=404)
    else:
        session = ChatSession(title=question[:50])
        db.session.add(session)
        db.session.commit()
        session_id = session.id

    # 检索相关段落（选了资料才有）
    citations = []
    context = ''
    if material_ids:
        hits = _search_chunks(material_ids, question)
        if hits:
            parts, seen = [], set()
            for chunk, material in hits:
                parts.append('【%s】\n%s' % (material.filename, chunk.content))
                citations.append({
                    'material_id': material.id,
                    'filename': material.filename,
                    'chunk_id': chunk.id,
                    'snippet': chunk.content[:SNIPPET_LEN],
                })
                seen.add(material.id)
            context = '\n\n'.join(parts)[:MAX_CONTEXT_CHARS]
            # 补充资料清单，方便 AI 按「来源：文件名」标注
            names = '、'.join(materials.filename for materials in
                              Material.query.filter(Material.id.in_(seen)))
            context = '（可用资料：%s）\n\n%s' % (names, context)

    system = TUTOR_PROMPT
    if context:
        system += '\n\n<资料上下文>\n%s\n</资料上下文>' % context

    # 最近历史对话（保持多轮连贯）
    history = (ChatMessage.query
               .filter_by(session_id=session_id)
               .order_by(ChatMessage.id.desc())
               .limit(HISTORY_LEN)
               .all())
    history.reverse()

    messages = [{'role': 'system', 'content': system}]
    messages += [{'role': m.role, 'content': m.content} for m in history]
    messages.append({'role': 'user', 'content': question})

    try:
        answer = call_llm(messages, temperature=0.7)
    except LLMError as exc:
        return err('AI 服务暂不可用：%s' % exc)

    now = datetime.now()
    db.session.add(ChatMessage(session_id=session_id, role='user',
                               content=question, created_at=now))
    db.session.add(ChatMessage(session_id=session_id, role='assistant',
                               content=answer, citations=citations or None,
                               created_at=now))
    db.session.commit()
    return ok({'session_id': session_id, 'answer': answer, 'citations': citations})


@bp.route('/chat/sessions', methods=['GET'])
def list_sessions():
    """GET /api/chat/sessions —— 会话列表
    Query: page, page_size
    返回: {total, list:[{id, title, created_at}]}
    """
    page = max(int(request.args.get('page', 1)), 1)
    page_size = min(max(int(request.args.get('page_size', 50)), 1), 200)

    query = ChatSession.query.order_by(ChatSession.created_at.desc(), ChatSession.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return ok({
        'total': total,
        'list': [{
            'id': s.id,
            'title': s.title,
            'created_at': s.created_at.strftime('%Y-%m-%d %H:%M:%S') if s.created_at else None,
        } for s in items],
    })


@bp.route('/chat/sessions', methods=['POST'])
def create_session():
    """POST /api/chat/sessions —— 创建空对话（2026-09-15 用户新增接口）
    入参: {title?: string}（可省，默认"新对话"）
    返回: {id, title}
    """
    body = request.get_json(silent=True) or {}
    title = (body.get('title') or '').strip() or '新对话'
    session = ChatSession(title=title[:255])
    db.session.add(session)
    db.session.commit()
    return ok({'id': session.id, 'title': session.title})


@bp.route('/chat/sessions/<int:session_id>', methods=['DELETE'])
def delete_session(session_id):
    """DELETE /api/chat/sessions/:id —— 删除对话及全部消息（2026-09-15 用户新增接口）
    返回: {}
    """
    session = db.session.get(ChatSession, session_id)
    if session is None:
        return err('会话不存在', code=404)
    db.session.delete(session)  # ORM 级联删除 messages
    db.session.commit()
    return ok({})


@bp.route('/chat/sessions/<int:session_id>/messages', methods=['GET'])
def list_messages(session_id):
    """GET /api/chat/sessions/:id/messages —— 会话历史消息
    返回: {list:[{role, content, citations, created_at}]}
    """
    session = db.session.get(ChatSession, session_id)
    if session is None:
        return err('会话不存在', code=404)

    msgs = (ChatMessage.query
            .filter_by(session_id=session_id)
            .order_by(ChatMessage.id)
            .all())
    return ok({'list': [{
        'role': m.role,
        'content': m.content,
        'citations': m.citations or [],
        'created_at': m.created_at.strftime('%Y-%m-%d %H:%M:%S') if m.created_at else None,
    } for m in msgs]})
