"""
routes/notes.py —— 记笔记接口（需求文档二·记笔记）
content 为所见即所得编辑器的 HTML 正文（前端 notes.js 约定），后端原样存储。
"""
from datetime import datetime

from flask import Blueprint, request

from database import db, ok, err
from models import Note

bp = Blueprint('notes', __name__)


def _parse_date(value):
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


@bp.route('/notes', methods=['POST'])
def create_note():
    """POST /api/notes —— 创建笔记
    入参: {title, content, study_date}
    返回: {id}
    """
    body = request.get_json(silent=True) or {}
    study_date = _parse_date(body.get('study_date'))
    if study_date is None:
        return err('study_date 格式应为 YYYY-MM-DD')
    note = Note(
        title=(body.get('title') or '').strip() or '无标题笔记',
        content=body.get('content') or '',
        study_date=study_date,
    )
    db.session.add(note)
    db.session.commit()
    return ok({'id': note.id})


@bp.route('/notes', methods=['GET'])
def list_notes():
    """GET /api/notes —— 笔记列表
    Query: page, page_size, keyword(可选，匹配标题)
    返回: {total, list:[{id, title, study_date, created_at}]}
    """
    page = max(int(request.args.get('page', 1)), 1)
    page_size = min(max(int(request.args.get('page_size', 50)), 1), 200)
    keyword = (request.args.get('keyword') or '').strip()

    query = Note.query
    if keyword:
        query = query.filter(Note.title.like('%' + keyword + '%'))
    query = query.order_by(Note.study_date.desc(), Note.id.desc())

    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return ok({
        'total': total,
        'list': [{
            'id': n.id,
            'title': n.title,
            'study_date': n.study_date.isoformat() if n.study_date else None,
            'created_at': n.created_at.strftime('%Y-%m-%d %H:%M:%S') if n.created_at else None,
        } for n in items],
    })


@bp.route('/notes/<int:note_id>', methods=['GET'])
def get_note(note_id):
    """GET /api/notes/:id —— 笔记详情
    返回: {id, title, content, study_date, created_at, updated_at}
    """
    n = db.session.get(Note, note_id)
    if n is None:
        return err('笔记不存在', code=404)
    return ok({
        'id': n.id,
        'title': n.title,
        'content': n.content,
        'study_date': n.study_date.isoformat() if n.study_date else None,
        'created_at': n.created_at.strftime('%Y-%m-%d %H:%M:%S') if n.created_at else None,
        'updated_at': n.updated_at.strftime('%Y-%m-%d %H:%M:%S') if n.updated_at else None,
    })


@bp.route('/notes/<int:note_id>', methods=['PUT'])
def update_note(note_id):
    """PUT /api/notes/:id —— 更新笔记（字段均可选）
    入参: {title?, content?, study_date?}
    返回: {id}
    """
    n = db.session.get(Note, note_id)
    if n is None:
        return err('笔记不存在', code=404)

    body = request.get_json(silent=True) or {}
    if 'title' in body:
        n.title = (body.get('title') or '').strip() or '无标题笔记'
    if 'content' in body:
        n.content = body.get('content') or ''
    if 'study_date' in body:
        study_date = _parse_date(body.get('study_date'))
        if study_date is None:
            return err('study_date 格式应为 YYYY-MM-DD')
        n.study_date = study_date
    db.session.commit()
    return ok({'id': n.id})


@bp.route('/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    """DELETE /api/notes/:id —— 删除笔记
    返回: {}
    """
    n = db.session.get(Note, note_id)
    if n is None:
        return err('笔记不存在', code=404)
    db.session.delete(n)
    db.session.commit()
    return ok({})
