"""
app.py —— Flask 入口
启动：python app.py（首次启动自动建表，并自动创建上传目录）
"""
import os

from flask import Flask, send_from_directory

import models  # noqa: F401  导入以注册所有模型
from config import Config
from database import db
from routes import register_blueprints

# 前端目录（backend 的上一级下的 frontend/）
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    os.makedirs(app.config['UPLOAD_DIR'], exist_ok=True)

    db.init_app(app)
    with app.app_context():
        db.create_all()  # 按《功能需求文档》第三节的表结构建表

    register_blueprints(app)

    # 托管前端静态页面，访问 http://host:port/ 即为学习助手页面
    @app.route('/')
    def index():
        return send_from_directory(FRONTEND_DIR, 'index.html')

    @app.route('/<path:path>')
    def frontend_files(path):
        return send_from_directory(FRONTEND_DIR, path)

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(host=app.config['HOST'], port=app.config['PORT'], debug=True)
