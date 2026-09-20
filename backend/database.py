"""
database.py —— SQLAlchemy 实例 + 统一响应封装
响应约定（需求文档二）：{ "code": 0, "msg": "ok", "data": ... }，code != 0 表示出错
"""
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def ok(data=None, msg='ok'):
    return {'code': 0, 'msg': msg, 'data': data}


def err(msg='error', code=1):
    return {'code': code, 'msg': msg, 'data': None}
