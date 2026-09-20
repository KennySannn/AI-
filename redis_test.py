import redis
import json

r = redis.Redis(host='localhost', port=6379, decode_responses=True)

def show_all(标题=""):
    """打印 Redis 里当前所有内容"""
    print("\n" + "=" * 50)
    print(f"📦 Redis 当前内容 {标题}")
    print("=" * 50)
    keys = r.keys('*')
    if not keys:
        print("（空）")
        return
    for key in sorted(keys):
        t = r.type(key)
        ttl = r.ttl(key)
        ttl_str = "永不过期" if ttl == -1 else f"{ttl}秒后过期"
        print(f"\n🔑 key: {key}")
        print(f"   类型: {t} | {ttl_str}")
        if t == 'string':
            print(f"   值: {r.get(key)}")
        elif t == 'hash':
            print(f"   值: {r.hgetall(key)}")
        elif t == 'list':
            print(f"   值: {r.lrange(key, 0, -1)}")
        elif t == 'set':
            print(f"   值: {r.smembers(key)}")
        elif t == 'zset':
            print(f"   值: {r.zrange(key, 0, -1, withscores=True)}")
    print("\n" + "=" * 50)


###################################################################################

import redis
import json

r = redis.Redis(host='localhost', port=6379, decode_responses=True)
r.flushall()

def save_message(session_id, role, content):
    key = f"session:{session_id}"
    msg = json.dumps({"role": role, "content": content}, ensure_ascii=False)
    r.rpush(key, msg)
    r.expire(key, 3600)
    print(f"  💾 存入 [{role}]: {content}")

def show_session(session_id):
    key = f"session:{session_id}"
    print(f"\n📂 查看 {key} 的内容：")
    msgs = r.lrange(key, 0, -1)
    if not msgs:
        print("  （空）")
        return
    for i, m in enumerate(msgs):
        obj = json.loads(m)
        print(f"  [{i}] {obj['role']}: {obj['content']}")
    print(f"  ⏱️  TTL: {r.ttl(key)} 秒")


print(">>> 模拟一轮对话\n")
save_message("user_001", "user", "你好")
save_message("user_001", "assistant", "你好！有什么可以帮你？")
save_message("user_001", "user", "帮我查天气")
save_message("user_001", "assistant", "好的，请告诉我城市名")

show_session("user_001")

print("\n>>> 换个用户 user_002")
save_message("user_002", "user", "今天几号")
show_session("user_002")
show_session("user_001")   # 001 的历史还在