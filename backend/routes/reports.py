"""
routes/reports.py —— 周报接口（需求文档二·出周报）
生成：汇总区间内笔记/资料/测验/知识点数据 + prompts.REPORT_PROMPT → DeepSeek 生成 Markdown 周报
"""
import json
from datetime import datetime, timedelta

from flask import Blueprint, request

from database import db, ok, err
from models import Note, Material, Quiz, KnowledgeMastery, WeeklyReport
from prompts import REPORT_PROMPT
from llm_client import call_llm, LLMError

bp = Blueprint('reports', __name__)


@bp.route('/reports/weekly/generate', methods=['POST'])
def generate_report():
    """POST /api/reports/weekly/generate —— 生成周报
    入参: {week_start, week_end?}（week_end 可选，默认 start+6 天）
    返回: {report_id}
    """
    body = request.get_json(silent=True) or {}
    try:
        start = datetime.strptime(body.get('week_start') or '', '%Y-%m-%d').date()
    except ValueError:
        return err('week_start 格式应为 YYYY-MM-DD')
    if body.get('week_end'):
        try:
            end = datetime.strptime(body['week_end'], '%Y-%m-%d').date()
        except ValueError:
            return err('week_end 格式应为 YYYY-MM-DD')
    else:
        end = start + timedelta(days=6)
    if end < start:
        return err('week_end 不能早于 week_start')

    end_inclusive = datetime.combine(end, datetime.max.time())

    # ---- 汇总区间数据 ----
    notes = Note.query.filter(Note.study_date.between(start, end)).all()
    materials = Material.query.filter(
        Material.uploaded_at.between(datetime.combine(start, datetime.min.time()),
                                     end_inclusive)).all()
    quizzes = (Quiz.query
               .filter(Quiz.created_at.between(datetime.combine(start, datetime.min.time()),
                                               end_inclusive),
                       Quiz.status == 1)
               .all())
    scores = [q.total_score / q.full_score for q in quizzes if q.full_score]
    avg_score_rate = round(sum(scores) / len(scores), 3) if scores else None

    kps = KnowledgeMastery.query.all()
    weak_points = [k.name for k in kps if k.mastery == 'weak']

    stats = {
        'notes_written': len(notes),
        'materials_uploaded': len(materials),
        'quizzes_taken': len(quizzes),
        'avg_score_rate': avg_score_rate,
        'weak_points': weak_points,
    }

    # 给 AI 的细节：学了什么（笔记标题+资料名）、薄弱点及正确率
    detail = {
        'week_start': start.isoformat(),
        'week_end': end.isoformat(),
        'note_titles': [n.title for n in notes if n.title],
        'material_names': [m.filename for m in materials],
        'quizzes': [{'score': q.total_score, 'full_score': q.full_score,
                     'duration_seconds': q.duration_seconds} for q in quizzes],
        'knowledge_points': [{'name': k.name, 'correct_rate': round(k.correct_rate, 3),
                              'mastery': k.mastery} for k in kps if k.quiz_count],
    }

    try:
        content = call_llm([
            {'role': 'system', 'content': REPORT_PROMPT},
            {'role': 'user', 'content': '请基于以下数据生成本期学习周报：\n<一周统计数据>\n%s\n</一周统计数据>'
                % json.dumps({'stats': stats, 'detail': detail}, ensure_ascii=False)},
        ], temperature=0.6)
    except LLMError as exc:
        return err('周报生成失败：%s' % exc)

    report = WeeklyReport(week_start=start, week_end=end, content=content,
                          stats=stats, created_at=datetime.now())
    db.session.add(report)
    db.session.commit()
    return ok({'report_id': report.id})


@bp.route('/reports/weekly', methods=['GET'])
def list_reports():
    """GET /api/reports/weekly —— 周报列表
    Query: page, page_size
    返回: {total, list:[{id, week_start, week_end, created_at}]}
    """
    page = max(int(request.args.get('page', 1)), 1)
    page_size = min(max(int(request.args.get('page_size', 50)), 1), 200)

    query = WeeklyReport.query.order_by(WeeklyReport.created_at.desc(), WeeklyReport.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return ok({
        'total': total,
        'list': [{
            'id': r.id,
            'week_start': r.week_start.isoformat() if r.week_start else None,
            'week_end': r.week_end.isoformat() if r.week_end else None,
            'created_at': r.created_at.strftime('%Y-%m-%d %H:%M:%S') if r.created_at else None,
        } for r in items],
    })


@bp.route('/reports/weekly/<int:report_id>', methods=['GET'])
def get_report(report_id):
    """GET /api/reports/weekly/:id —— 周报详情"""
    report = db.session.get(WeeklyReport, report_id)
    if report is None:
        return err('周报不存在', code=404)
    return ok({
        'id': report.id,
        'week_start': report.week_start.isoformat() if report.week_start else None,
        'week_end': report.week_end.isoformat() if report.week_end else None,
        'content': report.content,
        'stats': report.stats or {},
        'created_at': report.created_at.strftime('%Y-%m-%d %H:%M:%S') if report.created_at else None,
    })
