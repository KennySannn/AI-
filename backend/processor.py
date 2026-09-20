"""
processor.py —— 资料后台处理流水线
上传后由后台线程执行：读文字 → 删旧分块 → 分块入库 → 更新状态。
用户无需等待，状态经 materials.status 暴露（0=解析中 1=可用 2=失败）。
"""
import traceback

from database import db
from models import Material, Chunk
from parser import extract_text, chunk_text


def process_material(app, material_id):
    """在后台线程中运行，自带应用上下文。"""
    with app.app_context():
        material = db.session.get(Material, material_id)
        if material is None:
            return
        try:
            text = extract_text(material.file_path, material.file_type)
            chunks = chunk_text(text)

            Chunk.query.filter_by(material_id=material.id).delete()
            for index, content in enumerate(chunks):
                db.session.add(Chunk(material_id=material.id,
                                     chunk_index=index, content=content))
            material.chunk_count = len(chunks)
            material.status = 1  # 可用
            db.session.commit()
        except Exception:
            db.session.rollback()
            traceback.print_exc()
            material = db.session.get(Material, material_id)
            if material is not None:
                material.status = 2  # 失败
                material.chunk_count = 0
                db.session.commit()


def start_processing(app, material_id):
    """启动后台解析线程（守护线程，不阻塞请求）。"""
    import threading
    thread = threading.Thread(target=process_material, args=(app, material_id),
                              daemon=True, name='material-%s' % material_id)
    thread.start()
