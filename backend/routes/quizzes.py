"""
routes/quizzes.py —— 测评接口（需求文档二·做测评）
出题：所选资料全文分块 + prompts.QUIZ_GENERATOR_PROMPT → DeepSeek 出 JSON → 落库（不返回答案）
改卷：客观题（选择/判断）按提示词规则本地精确比对；简答题交 prompts.GRADER_PROMPT 评分
      → 结果落库 → 聚合知识点掌握（knowledge_mastery）
"""
from datetime import datetime
import json

from flask import Blueprint, request

from database import db, ok, err
from models import Material, Chunk, Quiz, QuizQuestion, QuizAnswer, KnowledgeMastery
from prompts import QUIZ_GENERATOR_PROMPT, GRADER_PROMPT
from llm_client import call_llm_json, LLMError

bp = Blueprint('quizzes', __name__)

MAX_CONTEXT_CHARS = 28000  # 出题时资料上下文总量上限


def _build_context(material_ids):
    """把所选 ready 资料的分块拼成带文件名标注的资料上下文。"""
    materials = (Material.query
                 .filter(Material.id.in_(material_ids), Material.status == 1)
                 .order_by(Material.id).all())
    if not materials:
        return None, []

    parts = []
    used = 0
    for m in materials:
        body = []
        for c in m.chunks.order_by(Chunk.chunk_index):
            if used + len(c.content) > MAX_CONTEXT_CHARS:
                break
            body.append(c.content)
            used += len(c.content)
        if body:
            parts.append('【资料：%s】\n%s' % (m.filename, '\n'.join(body)))
    return '\n\n'.join(parts), [m.filename for m in materials]


@bp.route('/quizzes/generate', methods=['POST'])
def generate_quiz():
    """POST /api/quizzes/generate —— 基于资料出题
    入参: {material_ids, choice_count, judge_count, short_count}
    返回: {quiz_id, questions:[{question_id, type, question, options, score, difficulty}]}
    （出题时不返回答案）
    """
    body = request.get_json(silent=True) or {}
    material_ids = body.get('material_ids') or []
    counts = {
        'choice': int(body.get('choice_count') or 0),
        'judge': int(body.get('judge_count') or 0),
        'short': int(body.get('short_count') or 0),
    }
    if not material_ids:
        return err('请选择要出题的资料')
    if sum(counts.values()) == 0:
        return err('题目数量不能为 0')

    context, filenames = _build_context(material_ids)
    if not context:
        return err('所选资料均不可用（可能尚未解析完成或解析失败）')

    user_msg = (
        '请基于以下资料出题，数量要求：单选 %d 道、判断 %d 道、简答 %d 道。'
        '难度需简单/中等/较难搭配，不要集中在同一档。\n\n'
        '<资料上下文>\n%s\n</资料上下文>'
        % (counts['choice'], counts['judge'], counts['short'], context)
    )
    try:
        data = call_llm_json([
            {'role': 'system', 'content': QUIZ_GENERATOR_PROMPT},
            {'role': 'user', 'content': user_msg},
        ], temperature=0.8)
    except LLMError as exc:
        return err('出题失败：%s' % exc)

    raw = data.get('questions') or []
    if not isinstance(raw, list) or not raw:
        return err('AI 未返回有效题目，请重试')

    # 按题型各截取所需数量，清洗字段
    picked = {'choice': [], 'judge': [], 'short': []}
    for item in raw:
        if not isinstance(item, dict):
            continue
        qtype = item.get('type')
        if qtype in picked and len(picked[qtype]) < counts[qtype] and (item.get('question') or '').strip():
            picked[qtype].append(item)

    quiz = Quiz(material_ids=material_ids, status=0, total_score=0,
                full_score=sum(counts.values()), created_at=datetime.now())
    db.session.add(quiz)
    db.session.flush()

    result = []
    for qtype in ('choice', 'judge', 'short'):
        for item in picked[qtype]:
            options = item.get('options') if qtype == 'choice' else None
            # AI 偶尔把 options 包成 JSON 字符串，先还原成数组
            if isinstance(options, str):
                try:
                    options = json.loads(options)
                except ValueError:
                    options = None
            if qtype == 'choice':
                if not isinstance(options, list) or len(options) < 2:
                    continue  # 缺选项的选择题丢弃
                options = [str(o) for o in options]
            answer = str(item.get('answer') or '').strip()
            if not answer:
                continue
            # 答案归一化：选择取选项字母；判断统一为 对/错
            if qtype == 'choice':
                answer = _norm_choice(answer)
            elif qtype == 'judge':
                answer = _norm_judge(answer)
            difficulty = item.get('difficulty')
            if difficulty not in ('简单', '中等', '较难'):
                difficulty = '中等'
            question = QuizQuestion(
                quiz_id=quiz.id,
                type=qtype,
                question=str(item['question']).strip(),
                options=options if qtype == 'choice' else None,
                answer=answer,
                score=1,
                difficulty=difficulty,
                knowledge_point=(str(item.get('knowledge_point') or '未分类').strip())[:100],
            )
            db.session.add(question)
            db.session.flush()
            result.append({
                'question_id': question.id,
                'type': qtype,
                'question': question.question,
                'options': question.options,
                'score': 1,
                'difficulty': difficulty,
            })
    db.session.commit()

    if not result:
        return err('AI 返回的题目均无效，请重试')
    return ok({'quiz_id': quiz.id, 'questions': result})


def _norm_choice(answer):
    """提取选项字母 A-D。"""
    text = str(answer or '').strip().upper()
    for ch in text:
        if ch in 'ABCD':
            return ch
    return text


def _norm_judge(answer):
    """统一判断题答案为 对/错。兼容 正确/错误、A/B（前端固定选项 A=正确 B=错误）。"""
    text = str(answer or '').strip()
    if text in ('正确', '对', 'T', 'TRUE', '是', 'A'):
        return '对'
    if text in ('错误', '错', 'F', 'FALSE', '否', 'B'):
        return '错'
    return text


@bp.route('/quizzes/<int:quiz_id>/submit', methods=['POST'])
def submit_quiz(quiz_id):
    """POST /api/quizzes/:id/submit —— 提交答卷并自动改卷
    入参: {answers:[{question_id, answer}], duration_seconds}
    返回: {total_score, full_score, results:[{question_id, got_score, is_correct, comment}]}
    """
    quiz = db.session.get(Quiz, quiz_id)
    if quiz is None:
        return err('测验不存在', code=404)
    if quiz.status == 1:
        return err('该测验已提交过')

    body = request.get_json(silent=True) or {}
    answers = {a.get('question_id'): a.get('answer') for a in (body.get('answers') or [])}
    questions = QuizQuestion.query.filter_by(quiz_id=quiz_id).order_by(QuizQuestion.id).all()
    if not questions:
        return err('该测验没有题目', code=404)

    # ---- 客观题：本地精确比对（与评分员提示词规则 1/2 一致） ----
    results = {}
    shorts = []
    for q in questions:
        user_answer = answers.get(q.id)
        if q.type == 'choice':
            got = 1.0 if _norm_choice(user_answer) == _norm_choice(q.answer) else 0.0
            results[q.id] = {'got_score': got, 'is_correct': got == 1.0, 'comment': ''}
        elif q.type == 'judge':
            got = 1.0 if _norm_judge(user_answer) == _norm_judge(q.answer) else 0.0
            results[q.id] = {'got_score': got, 'is_correct': got == 1.0, 'comment': ''}
        else:
            shorts.append(q)

    # ---- 简答题：交评分员（DeepSeek）批改，0 / 0.5 / 1 ----
    if shorts:
        items = [{
            'question_id': q.id,
            'question': q.question,
            'standard_answer': q.answer,
            'user_answer': str(answers.get(q.id) or ''),
        } for q in shorts]
        try:
            data = call_llm_json([
                {'role': 'system', 'content': GRADER_PROMPT},
                {'role': 'user', 'content': '请批改以下简答题：\n%s'
                    % json.dumps(items, ensure_ascii=False)},
            ], temperature=0.1)
            by_id = {r.get('question_id'): r for r in (data.get('results') or [])
                     if isinstance(r, dict)}
            for q in shorts:
                r = by_id.get(q.id) or {}
                try:
                    got = float(r.get('got_score', 0))
                except (TypeError, ValueError):
                    got = 0.0
                got = min(max(got, 0.0), 1.0)
                results[q.id] = {
                    'got_score': got,
                    'is_correct': got == 1.0,
                    'comment': str(r.get('comment') or ''),
                }
        except LLMError:
            # 评分服务不可用：简答题按 0 分落库并注明，不阻断交卷
            for q in shorts:
                results[q.id] = {'got_score': 0.0, 'is_correct': False,
                                 'comment': 'AI 评分暂不可用，本次按 0 分计'}

    # ---- 落库 ----
    total = 0.0
    kp_stat = {}
    now = datetime.now()
    for q in questions:
        r = results[q.id]
        db.session.add(QuizAnswer(
            question_id=q.id, quiz_id=quiz_id,
            user_answer=str(answers.get(q.id) or ''),
            got_score=r['got_score'], is_correct=r['is_correct'],
            comment=r['comment'], answered_at=now,
        ))
        total += r['got_score']
        stat = kp_stat.setdefault(q.knowledge_point, [0, 0])
        stat[0] += 1
        stat[1] += 1 if r['is_correct'] else 0

    quiz.status = 1
    quiz.total_score = total
    quiz.full_score = float(len(questions))
    quiz.duration_seconds = int(body.get('duration_seconds') or 0)

    # ---- 聚合知识点掌握 ----
    for name, (count, correct) in kp_stat.items():
        row = KnowledgeMastery.query.filter_by(name=name).first()
        if row is None:
            row = KnowledgeMastery(name=name)
            db.session.add(row)
        row.quiz_count = (row.quiz_count or 0) + count
        row.correct_count = (row.correct_count or 0) + correct
        row.correct_rate = row.correct_count / row.quiz_count if row.quiz_count else 0
        row.mastery = ('mastered' if row.correct_rate >= 0.8
                       else 'weak' if row.correct_rate < 0.6 else 'unknown')
    db.session.commit()

    return ok({
        'total_score': total,
        'full_score': quiz.full_score,
        'results': [{'question_id': q.id, **results[q.id]} for q in questions],
    })


@bp.route('/quizzes/<int:quiz_id>', methods=['GET'])
def get_quiz(quiz_id):
    """GET /api/quizzes/:id —— 测验详情（含答案、我的答案、点评）"""
    quiz = db.session.get(Quiz, quiz_id)
    if quiz is None:
        return err('测验不存在', code=404)

    questions = QuizQuestion.query.filter_by(quiz_id=quiz_id).order_by(QuizQuestion.id).all()
    answers = {a.question_id: a for a in
               QuizAnswer.query.filter_by(quiz_id=quiz_id).all()}
    return ok({
        'quiz_id': quiz.id,
        'created_at': quiz.created_at.strftime('%Y-%m-%d %H:%M:%S') if quiz.created_at else None,
        'duration_seconds': quiz.duration_seconds,
        'status': quiz.status,
        'total_score': quiz.total_score,
        'full_score': quiz.full_score,
        'questions': [{
            'question_id': q.id,
            'type': q.type,
            'question': q.question,
            'options': q.options,
            'score': q.score,
            'answer': q.answer,
            'difficulty': q.difficulty,
            'knowledge_point': q.knowledge_point,
        } for q in questions],
        'results': [{
            'question_id': q.id,
            'user_answer': answers[q.id].user_answer if q.id in answers else None,
            'got_score': answers[q.id].got_score if q.id in answers else None,
            'is_correct': bool(answers[q.id].is_correct) if q.id in answers else None,
            'comment': answers[q.id].comment if q.id in answers else None,
        } for q in questions],
    })


@bp.route('/quizzes', methods=['GET'])
def list_quizzes():
    """GET /api/quizzes —— 测验记录列表
    Query: page, page_size
    返回: {total, list:[{quiz_id, total_score, full_score, duration_seconds, created_at}]}
    """
    page = max(int(request.args.get('page', 1)), 1)
    page_size = min(max(int(request.args.get('page_size', 50)), 1), 200)

    query = Quiz.query.filter(Quiz.status == 1).order_by(Quiz.created_at.desc(), Quiz.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return ok({
        'total': total,
        'list': [{
            'quiz_id': qz.id,
            'total_score': qz.total_score,
            'full_score': qz.full_score,
            'duration_seconds': qz.duration_seconds,
            'created_at': qz.created_at.strftime('%Y-%m-%d %H:%M:%S') if qz.created_at else None,
        } for qz in items],
    })
