"""
models.py —— 数据库模型，与《功能需求文档.md》第三节数据库设计一一对应
"""
from datetime import datetime

from database import db


class Material(db.Model):
    """资料表"""
    __tablename__ = 'materials'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    filename = db.Column(db.String(255), nullable=False)       # 原始文件名
    file_type = db.Column(db.String(10), nullable=False)       # pdf/ppt/pptx/doc/docx/md/txt
    file_path = db.Column(db.String(500), nullable=False)      # 存储路径
    size = db.Column(db.BigInteger, default=0)                 # 字节数
    status = db.Column(db.SmallInteger, default=0)             # 0=解析中 1=可用 2=失败
    chunk_count = db.Column(db.Integer, default=0)             # 分块数量
    uploaded_at = db.Column(db.DateTime, default=datetime.now)

    chunks = db.relationship('Chunk', backref='material',
                             cascade='all, delete-orphan', lazy='dynamic')


class Chunk(db.Model):
    """资料分块表（暂不向量化，embedding 列预留为空）"""
    __tablename__ = 'chunks'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    material_id = db.Column(db.Integer, db.ForeignKey('materials.id', ondelete='CASCADE'),
                            nullable=False, index=True)
    chunk_index = db.Column(db.Integer, nullable=False)        # 块序号
    content = db.Column(db.Text, nullable=False)               # 分块文本
    embedding = db.Column(db.Text)                             # 预留，当前不使用


class ChatSession(db.Model):
    """聊天会话表"""
    __tablename__ = 'chat_sessions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(255), default='新对话')         # 默认取首条提问截断
    created_at = db.Column(db.DateTime, default=datetime.now)

    messages = db.relationship('ChatMessage', backref='session',
                               cascade='all, delete-orphan', lazy='dynamic')


class ChatMessage(db.Model):
    """聊天消息表"""
    __tablename__ = 'chat_messages'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    session_id = db.Column(db.Integer, db.ForeignKey('chat_sessions.id', ondelete='CASCADE'),
                           nullable=False, index=True)
    role = db.Column(db.String(10), nullable=False)            # user / assistant
    content = db.Column(db.Text, nullable=False)
    citations = db.Column(db.JSON)                             # [{material_id, filename, chunk_id, snippet}]
    created_at = db.Column(db.DateTime, default=datetime.now)


class Note(db.Model):
    """笔记表（material_id 为空表示独立笔记，非空为资料笔记）"""
    __tablename__ = 'notes'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(255))
    content = db.Column(db.Text)                               # 正文（所见即所得编辑器，存 HTML）
    material_id = db.Column(db.Integer, db.ForeignKey('materials.id'))  # 资料笔记关联
    study_date = db.Column(db.Date, index=True)                # 学习日期
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)


class Quiz(db.Model):
    """测验表"""
    __tablename__ = 'quizzes'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    material_ids = db.Column(db.JSON)                          # 出题依据的资料 ID 列表
    status = db.Column(db.SmallInteger, default=0)             # 0=未作答 1=已完成
    total_score = db.Column(db.Float, default=0)
    full_score = db.Column(db.Float, default=0)
    duration_seconds = db.Column(db.Integer)                   # 答题用时（秒）
    created_at = db.Column(db.DateTime, default=datetime.now)


class QuizQuestion(db.Model):
    """题目表"""
    __tablename__ = 'quiz_questions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    quiz_id = db.Column(db.Integer, db.ForeignKey('quizzes.id', ondelete='CASCADE'),
                        nullable=False, index=True)
    type = db.Column(db.String(10), nullable=False)            # choice / judge / short
    question = db.Column(db.Text, nullable=False)              # 题干
    options = db.Column(db.JSON)                               # 选择题选项；判/简答为 NULL
    answer = db.Column(db.Text)                                # 标准答案（选择存字母；简答存采分点）
    score = db.Column(db.Float, default=1)                     # 分值，默认 1 分
    difficulty = db.Column(db.String(10))                      # 简单 / 中等 / 较难
    knowledge_point = db.Column(db.String(100), index=True)    # 知识点归属


class QuizAnswer(db.Model):
    """作答记录表"""
    __tablename__ = 'quiz_answers'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    question_id = db.Column(db.Integer, db.ForeignKey('quiz_questions.id'), nullable=False, index=True)
    quiz_id = db.Column(db.Integer, db.ForeignKey('quizzes.id'), nullable=False, index=True)  # 冗余便于统计
    user_answer = db.Column(db.Text)
    got_score = db.Column(db.Float, default=0)                 # 选择/判断 0 或 1；简答 0/0.5/1
    is_correct = db.Column(db.Boolean, default=False)
    comment = db.Column(db.Text)                               # AI 点评（简答题）
    answered_at = db.Column(db.DateTime, default=datetime.now)


class KnowledgeMastery(db.Model):
    """知识点掌握表（由答题结果聚合）"""
    __tablename__ = 'knowledge_mastery'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    quiz_count = db.Column(db.Integer, default=0)              # 被考次数
    correct_count = db.Column(db.Integer, default=0)           # 答对次数
    correct_rate = db.Column(db.Float, default=0)              # 正确率 0~1
    mastery = db.Column(db.String(10), default='unknown')      # mastered / weak / unknown
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)


class WeeklyReport(db.Model):
    """周报表"""
    __tablename__ = 'weekly_reports'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    week_start = db.Column(db.Date, nullable=False, index=True)
    week_end = db.Column(db.Date, nullable=False)              # 统计区间（默认 7 天，支持自定义）
    content = db.Column(db.Text)                               # AI 生成的周报正文（Markdown）
    stats = db.Column(db.JSON)                                 # {notes_written, materials_uploaded, quizzes_taken, avg_score_rate, weak_points[]}
    created_at = db.Column(db.DateTime, default=datetime.now)
