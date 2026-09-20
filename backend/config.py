"""
config.py —— 全部配置项
优先级：环境变量 / .env 文件 > 本文件默认值
"""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    # ---------- 服务 ----------
    HOST = os.getenv('HOST', '127.0.0.1')
    PORT = int(os.getenv('PORT', '5000'))

    # ---------- 数据库 ----------
    # 默认 SQLite 便于开发启动；按需求文档生产环境用 MySQL，示例：
    #   mysql+pymysql://user:password@localhost:3306/ai_study?charset=utf8mb4
    SQLALCHEMY_DATABASE_URI = os.getenv(
        'DATABASE_URI',
        'sqlite:///' + os.path.join(BASE_DIR, 'data.sqlite3'),
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ---------- 上传 ----------
    UPLOAD_DIR = os.getenv('UPLOAD_DIR', os.path.join(BASE_DIR, 'uploads'))
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB
    ALLOWED_EXTENSIONS = {'pdf', 'ppt', 'pptx', 'doc', 'docx', 'md', 'txt'}

    # ---------- 大模型（URL 与 APIKEY 独立配置，OpenAI 兼容 /chat/completions） ----------
    LLM_API_URL = os.getenv('LLM_API_URL', 'https://api.deepseek.com/chat/completions')
    LLM_API_KEY = os.getenv('LLM_API_KEY', '')          # 必填：请在 .env 中配置
    LLM_MODEL = os.getenv('LLM_MODEL', 'deepseek-chat') # DeepSeek 官方模型
    LLM_TIMEOUT = int(os.getenv('LLM_TIMEOUT', '60'))   # 秒
