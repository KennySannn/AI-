"""
routes/materials.py —— 资料接口（需求文档二·传资料）
说明：不使用向量模型/不使用 RAG，解析仅提取文本并分块存储；
     聊资料时将所选资料的文本内容直接提供给 LLM。
流程：上传 → 存文件 → 建记录(status=parsing) → 后台线程解析 → status=ready/failed
"""
import os
import uuid
from datetime import datetime

from flask import Blueprint, current_app, request

from config import Config
from database import db, ok, err
from models import Material, Note
from processor import start_processing

bp = Blueprint('materials', __name__)

STATUS_TEXT = {0: 'parsing', 1: 'ready', 2: 'failed'}


def _ext_of(filename):
    return os.path.splitext(filename or '')[1].lstrip('.').lower()


@bp.route('/materials/upload', methods=['POST'])
def upload_material():
    """POST /api/materials/upload —— 上传资料（multipart/form-data: file）
    校验扩展名 → 保存文件 → 建记录 → 后台异步解析
    返回: {id, filename, status: "parsing"}
    """
    file = request.files.get('file')
    if file is None or not file.filename:
        return err('缺少文件')
    ext = _ext_of(file.filename)
    if ext not in Config.ALLOWED_EXTENSIONS:
        return err('不支持的文件类型: %s（仅支持 %s）'
                   % (ext or '无扩展名', '/'.join(sorted(Config.ALLOWED_EXTENSIONS))))

    stored_name = uuid.uuid4().hex + '.' + ext
    file_path = os.path.join(current_app.config['UPLOAD_DIR'], stored_name)
    file.save(file_path)

    material = Material(
        filename=os.path.basename(file.filename),
        file_type=ext,
        file_path=file_path,
        size=os.path.getsize(file_path),
        status=0,
        chunk_count=0,
    )
    db.session.add(material)
    db.session.commit()

    start_processing(current_app._get_current_object(), material.id)
    return ok({'id': material.id, 'filename': material.filename, 'status': 'parsing'})


@bp.route('/materials', methods=['GET'])
def list_materials():
    """GET /api/materials —— 资料列表
    Query: page, page_size
    返回: {total, list:[{id, filename, file_type, size, status, chunk_count, uploaded_at}]}
    """
    page = max(int(request.args.get('page', 1)), 1)
    page_size = min(max(int(request.args.get('page_size', 50)), 1), 200)

    query = Material.query.order_by(Material.uploaded_at.desc(), Material.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return ok({
        'total': total,
        'list': [{
            'id': m.id,
            'filename': m.filename,
            'file_type': m.file_type,
            'size': m.size,
            'status': STATUS_TEXT.get(m.status, 'failed'),
            'chunk_count': m.chunk_count,
            'uploaded_at': m.uploaded_at.strftime('%Y-%m-%d %H:%M:%S') if m.uploaded_at else None,
        } for m in items],
    })


@bp.route('/materials/<int:material_id>/retry', methods=['POST'])
def retry_material(material_id):
    """POST /api/materials/:id/retry —— 解析失败的资料重新触发解析
    返回: {id, status: "parsing"}
    """
    material = db.session.get(Material, material_id)
    if material is None:
        return err('资料不存在', code=404)
    if material.status != 2:
        return err('仅解析失败的资料可重试')

    material.status = 0
    material.chunk_count = 0
    db.session.commit()
    start_processing(current_app._get_current_object(), material.id)
    return ok({'id': material.id, 'status': 'parsing'})


@bp.route('/materials/<int:material_id>/note', methods=['GET'])
def get_material_note(material_id):
    """GET /api/materials/:id/note —— 获取资料笔记（进度页 5.3）
    返回: {note_id|null, content|null, updated_at|null}
    """
    if db.session.get(Material, material_id) is None:
        return err('资料不存在', code=404)
    note = (Note.query.filter_by(material_id=material_id)
            .order_by(Note.id.desc()).first())
    if note is None:
        return ok({'note_id': None, 'content': None, 'updated_at': None})
    return ok({
        'note_id': note.id,
        'content': note.content,
        'updated_at': note.updated_at.strftime('%Y-%m-%d %H:%M:%S') if note.updated_at else None,
    })


@bp.route('/materials/<int:material_id>/note', methods=['PUT'])
def save_material_note(material_id):
    """PUT /api/materials/:id/note —— 保存资料笔记（自动保存，upsert）
    入参: {content}
    返回: {note_id, updated_at}
    """
    material = db.session.get(Material, material_id)
    if material is None:
        return err('资料不存在', code=404)
    body = request.get_json(silent=True) or {}
    content = body.get('content') or ''

    note = (Note.query.filter_by(material_id=material_id)
            .order_by(Note.id.desc()).first())
    if note is None:
        note = Note(title='资料笔记：%s' % material.filename[:200],
                    material_id=material.id,
                    study_date=datetime.now().date())
        db.session.add(note)
    note.content = content
    db.session.commit()
    return ok({
        'note_id': note.id,
        'updated_at': note.updated_at.strftime('%Y-%m-%d %H:%M:%S')
                      if note.updated_at else datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    })


@bp.route('/materials/<int:material_id>', methods=['GET'])
def get_material(material_id):
    """GET /api/materials/:id —— 资料详情（2026-09-15 用户新增接口）
    返回: {id, filename, file_type, size, status, chunk_count, uploaded_at}
    """
    m = db.session.get(Material, material_id)
    if m is None:
        return err('资料不存在', code=404)
    return ok({
        'id': m.id,
        'filename': m.filename,
        'file_type': m.file_type,
        'size': m.size,
        'status': STATUS_TEXT.get(m.status, 'failed'),
        'chunk_count': m.chunk_count,
        'uploaded_at': m.uploaded_at.strftime('%Y-%m-%d %H:%M:%S') if m.uploaded_at else None,
    })


@bp.route('/materials/<int:material_id>', methods=['DELETE'])
def delete_material(material_id):
    """DELETE /api/materials/:id —— 删除资料：磁盘文件 + 分块 + 关联资料笔记 + 记录一起删
    返回: {}
    """
    material = db.session.get(Material, material_id)
    if material is None:
        return err('资料不存在', code=404)

    file_path = material.file_path

    # 删除关联的资料笔记（外键引用，先清再删主记录）
    Note.query.filter_by(material_id=material.id).delete()
    db.session.delete(material)  # ORM 级联删除 chunks
    db.session.commit()

    # 删除磁盘文件（记录已提交，文件删除失败不影响主流程）
    try:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        pass
    return ok({})
