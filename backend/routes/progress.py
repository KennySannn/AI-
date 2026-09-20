"""
routes/progress.py —— 进度接口（需求文档二·看进度）
数据全部来自其他模块的落库结果（notes / materials / quizzes / knowledge_mastery）。
"""
from flask import Blueprint

from database import db, ok, err
from models import Note, Material, Quiz, KnowledgeMastery

bp = Blueprint('progress', __name__)


@bp.route('/progress/overview', methods=['GET'])
def overview():
    """GET /api/progress/overview —— 学习概览
    返回: {note_count, material_count, quiz_count, avg_score_rate}
    """
    note_count = Note.query.count()
    material_count = Material.query.count()
    quiz_count = Quiz.query.filter(Quiz.status == 1).count()

    completed = Quiz.query.filter(Quiz.status == 1, Quiz.full_score > 0).all()
    rates = [q.total_score / q.full_score for q in completed]
    avg_score_rate = round(sum(rates) / len(rates), 3) if rates else None

    return ok({
        'note_count': note_count,
        'material_count': material_count,
        'quiz_count': quiz_count,
        'avg_score_rate': avg_score_rate,
    })


@bp.route('/progress/knowledge-points', methods=['GET'])
def knowledge_points():
    """GET /api/progress/knowledge-points —— 知识点掌握情况
    返回: {list:[{name, quiz_count, correct_count, correct_rate,
                  mastery: "mastered"|"weak"|"unknown"}]}
    掌握规则: correct_rate>=0.8 → mastered; <0.6 → weak; 其余 → unknown
    薄弱点 = 本接口结果中 mastery=="weak" 的条目（前端单独展示）
    """
    rows = (KnowledgeMastery.query
            .order_by(KnowledgeMastery.correct_rate, KnowledgeMastery.id)
            .all())  # 正确率低的排前，薄弱点自然靠前
    return ok({'list': [{
        'name': r.name,
        'quiz_count': r.quiz_count,
        'correct_count': r.correct_count,
        'correct_rate': round(r.correct_rate, 3) if r.correct_rate is not None else 0,
        'mastery': r.mastery or 'unknown',
    } for r in rows]})
