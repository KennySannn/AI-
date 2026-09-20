# AI学习助手 v1.0 —— 项目启动说明

一个基于大模型的学习助手：上传学习资料（PDF / PPT / Word / Markdown / TXT）后，可以与 AI 聊资料内容、自动出题测评、记录笔记、查看学习进度、生成学习周报。

- **前端**：纯 HTML / CSS / JavaScript，无构建步骤（位于 `frontend/`）
- **后端**：Python Flask（位于 `backend/`），负责全部接口、数据库、文件解析和 AI 调用
- **大模型**：DeepSeek（OpenAI 兼容接口），通过配置文件接入

## 目录结构

```
AI学习助手v1.0/
├── backend/            # Flask 后端
│   ├── app.py          # 入口：启动服务、自动建表、托管前端页面
│   ├── config.py       # 全部配置项（优先读 .env，其次用默认值）
│   ├── .env.example    # 配置模板（复制为 .env 后填写）
│   ├── requirements.txt# Python 依赖清单
│   ├── parser.py       # 文档文字提取（PDF/PPT/Word/MD/TXT）
│   ├── processor.py    # 上传后的后台解析流水线
│   ├── llm_client.py   # 大模型调用封装（自动重试 3 次）
│   ├── prompts.py      # AI 人设提示词（导师/出题官/评分员/周报）
│   ├── models.py       # 数据库表定义（10 张表）
│   └── routes/         # 6 个接口模块
├── frontend/           # 前端静态页面（由后端托管，无需单独启动服务）
│   ├── index.html
│   ├── css/  js/
└── .venv/              # Python 虚拟环境（如果没有，见下文创建）
```

## 环境要求

- **Python 3.10 及以上**（开发时使用 3.13 验证）
- 一个 **DeepSeek API Key**（在 [platform.deepseek.com](https://platform.deepseek.com) 申请；也可换成任何 OpenAI 兼容接口的平台）
- Windows / macOS / Linux 均可

## 一、配置后端程序

后端的所有可配置项集中在 `backend/.env` 文件中（没有的话，复制模板创建）。优先级：`.env` 文件 / 系统环境变量 > `config.py` 默认值。

**第 1 步：创建配置文件**

在 `backend/` 目录下，把 `.env.example` 复制一份并改名为 `.env`：

```
backend/.env.example   →   backend/.env
```

**第 2 步：填写大模型配置（必填项只有 API Key）**

打开 `.env`，至少填写 `LLM_API_KEY`：

```ini
# 大模型配置（URL 与 APIKEY 独立配置，OpenAI 兼容接口）
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_API_KEY=sk-你的key          ← 必填，替换成你自己的
LLM_MODEL=deepseek-chat
LLM_TIMEOUT=60
```

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `LLM_API_URL` | 大模型接口地址（须为 OpenAI 兼容的 /chat/completions 完整地址） | DeepSeek 官方地址 |
| `LLM_API_KEY` | 大模型密钥，**必填** | 无 |
| `LLM_MODEL` | 模型名 | `deepseek-chat` |
| `LLM_TIMEOUT` | 单次调用超时秒数 | 60 |

**第 3 步（可选）：其他配置**

以下项不改也能正常跑（默认 SQLite 数据库、127.0.0.1:5000）：

```ini
# 数据库：默认 SQLite（自动在 backend/ 下生成 data.sqlite3，无需安装任何数据库）
# 如要切换 MySQL，取消注释并改成：
# DATABASE_URI=mysql+pymysql://用户名:密码@localhost:3306/库名?charset=utf8mb4

# 服务地址与端口
# HOST=127.0.0.1
# PORT=5000
```

> 注意：AI 相关功能（聊天、出题、改简答题、周报）依赖 `LLM_API_KEY`，不填的话这几类功能会报错，其余功能（笔记、资料上传解析、资料管理）不受影响。

## 二、启动后端程序

**第 1 步：准备 Python 虚拟环境**

如果项目根目录下已有 `.venv/` 文件夹（自带依赖），可以跳过本步，直接看第 2 步。

没有的话，在**项目根目录**执行：

```bash
# 1. 创建虚拟环境
python -m venv .venv

# 2. 安装依赖
# Windows:
.venv\Scripts\pip install -r backend\requirements.txt
# macOS / Linux:
.venv/bin/pip install -r backend/requirements.txt
```

**第 2 步：启动**

在**项目根目录**执行：

```bash
# Windows:
.venv\Scripts\python.exe backend/app.py

# macOS / Linux:
.venv/bin/python backend/app.py
```

首次启动会自动：创建数据库表（10 张）→ 创建上传目录 `backend/uploads/` → 托管前端页面。看到类似下面的日志即为成功：

```
 * Running on http://127.0.0.1:5000
```

> 数据都存在 `backend/data.sqlite3`（SQLite 模式下），删除该文件即可清空全部数据重新开始。

## 三、启动前端程序

**前端不需要单独启动**——后端启动时已自动托管前端页面，直接用浏览器访问：

```
http://127.0.0.1:5000
```

即可看到学习助手的完整界面（顶部 6 个 Tab：记笔记、学习、资料库、测评、进度、报告；右上角小圆点是后台连接状态灯）。

> ⚠️ 不要直接双击打开 `frontend/index.html`：前端接口地址是相对路径 `/api`，脱离后端服务打开会全部请求失败（状态灯红色）。请始终通过 `http://127.0.0.1:5000` 访问。

## 四、验证项目跑起来了

按以下顺序快速自检：

1. **状态灯变绿**：页面右上角圆点为绿色 = 后端接口连通（红色/灰色说明后端没启动成功，回到第二节检查）。
2. **上传资料**：进入「资料库」Tab，拖入一份 PDF/Word/Markdown 文件，等状态从"解析中"变"完成"。
3. **聊资料**：进入「学习」Tab，下拉框选中刚上传的资料，提问资料里的内容，AI 回答下方可展开"引用来源"。
4. **做测评**：进入「测评」Tab，选资料和题数，点"开始测试"，AI 出题后作答提交即可看到得分和点评。
5. **看进度 / 出周报**：「进度」Tab 查看知识点掌握情况；「报告」Tab 生成并下载学习周报。

## 常见问题

| 现象 | 原因与解决 |
|---|---|
| 状态灯一直是红色 | 后端未启动或端口不对；确认终端里 Flask 已打印 `Running on http://127.0.0.1:5000` |
| 聊天/出题报错，上传资料正常 | `LLM_API_KEY` 未配置或无效；检查 `backend/.env` |
| 端口被占用 | `.env` 中改 `PORT=5001`，之后访问 `http://127.0.0.1:5000` 换成 5001 |
| 旧格式 `.doc` / `.ppt` 解析失败 | 旧版二进制格式支持有限，转存为 `.docx` / `.pptx` 后重新上传 |
| 想换别家大模型 | `.env` 里把 `LLM_API_URL` 改为该平台的 OpenAI 兼容完整地址、`LLM_API_KEY`/`LLM_MODEL` 一并替换即可 |