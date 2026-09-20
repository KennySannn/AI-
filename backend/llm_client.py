"""
llm_client.py —— 大模型调用封装（DeepSeek，OpenAI 兼容 /chat/completions）
- URL、APIKEY、MODEL 均在 config.py / .env 独立配置
- 调用失败自动重试，最多 3 次
- call_llm_json：自动剥掉 ```json ... ``` 包裹后解析 JSON
"""
import json
import re
import time

import requests
from flask import current_app


class LLMError(RuntimeError):
    """大模型调用失败（重试耗尽/配置缺失/返回异常）"""


def call_llm(messages, temperature=0.7, max_retries=3):
    """调用大模型，返回回复文本。失败自动重试，最多 max_retries 次。

    messages: [{"role": "system"|"user"|"assistant", "content": str}, ...]
    """
    cfg = current_app.config
    if not cfg['LLM_API_KEY']:
        raise LLMError('LLM_API_KEY 未配置，请在 backend/.env 中设置')

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(
                cfg['LLM_API_URL'],
                headers={
                    'Authorization': 'Bearer ' + cfg['LLM_API_KEY'],
                    'Content-Type': 'application/json',
                },
                json={
                    'model': cfg['LLM_MODEL'],
                    'messages': messages,
                    'temperature': temperature,
                },
                timeout=cfg['LLM_TIMEOUT'],
            )
            if resp.status_code != 200:
                raise LLMError('HTTP %s: %s' % (resp.status_code, resp.text[:200]))
            data = resp.json()
            return data['choices'][0]['message']['content']
        except Exception as exc:  # 网络/HTTP/解析等任何失败都计入重试
            last_err = exc
            if attempt < max_retries:
                time.sleep(1.5 * attempt)  # 1.5s / 3s 退避
    raise LLMError('调用大模型失败（已重试 %s 次）: %s' % (max_retries, last_err))


def strip_code_fence(text):
    """去掉回复外层的 ``` / ```json 代码围栏。"""
    t = (text or '').strip()
    if t.startswith('```'):
        t = re.sub(r'^```[a-zA-Z]*\s*', '', t)   # 去开头 ```json
        t = re.sub(r'\s*```\s*$', '', t)          # 去结尾 ```
    return t.strip()


def parse_llm_json(text):
    """解析 LLM 返回的 JSON：先剥围栏；仍失败则截取首个 { 到最后一个 } 再试。"""
    t = strip_code_fence(text)
    try:
        return json.loads(t)
    except ValueError:
        start, end = t.find('{'), t.rfind('}')
        if start != -1 and end > start:
            return json.loads(t[start:end + 1])
        raise LLMError('AI 返回内容不是有效 JSON: %s' % t[:120])


def call_llm_json(messages, temperature=0.7, max_retries=3):
    """调用大模型并解析 JSON 输出（自动处理 ```json 包裹）。"""
    return parse_llm_json(call_llm(messages, temperature=temperature,
                                   max_retries=max_retries))
