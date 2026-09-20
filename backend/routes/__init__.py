"""
routes/__init__.py —— 注册所有蓝图（统一前缀 /api）
"""
from . import chat, materials, notes, progress, quizzes, reports

BLUEPRINTS = [notes.bp, materials.bp, chat.bp, quizzes.bp, progress.bp, reports.bp]


def register_blueprints(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp, url_prefix='/api')
