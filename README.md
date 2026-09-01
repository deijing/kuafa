# 快发 Kuafa

直播切片智能成片原型：React 前端 + FastAPI + FFmpeg。

## 素材库目录结构

默认输入目录：`backend/data/input`

```text
backend/data/input/
  主播小美-今日专场/     ← 组（可自定义名称）
    clip1.mp4
    clip2.mp4
  主播大强-晚间场/
    ...
```

- 一级子文件夹 = 素材组（名称可自定义）
- 组内视频文件 = 该组素材
- 可在前端「输入目录」改为任意本地路径；也可点「恢复默认」

首次启动若 `input` 为空，会自动从上级 `案例/` 复制一份到 `演示主播-案例导入`。


## 启动

### 1. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. 前端

```bash
npm install
npm run dev
```

打开 http://localhost:5173/  
前端通过 Vite 代理访问 `/api` → `http://127.0.0.1:8000`。

## 使用

1. **素材库**：按组放入/上传直播切片视频
2. **智能混剪**：一键成片（语音整句切割 → 介绍/价格结构 → 自由画质选择 + 字幕 + BGM）
3. **批量制作**：多素材组一键并行出片，支持 4K/2K/1080P/720P 画质档位与防重算法
4. **封面生成**：纯粹极简图生图工作流，支持竖版 9:16 2K 超清电商爆款海报生成与音频智能提炼
5. **成片历史**：预览下载（任务写入本地 SQLite `backend/data/kuafa.db`，重启不丢）

### 成片与封面能力说明

- **视频输出画质**：支持 **4K 超高清 (2160×3840)**、**2K 极清 (1440×2560)**、**1080P 全高清 (1080×1920)** 及 **720P 高清 (720×1280)** 自由选择
- **切割算法**：默认用 **必剪 ASR**（[bcut-asr](https://github.com/SocialSisterYi/bcut-asr)）按整句切，避免切半个字；失败时回退 Whisper（需 OpenAI 兼容密钥）
- **结构化编排**：前段介绍商品，中后段价格/促销口播拼接
- **字幕烧录**：智能高位安全区口播字幕烧录
- **BGM 伴奏**：读取 `backend/data/bgm/` 自定义或内置背景音乐
- **AI 封面**：支持 **竖版 9:16 2K** 超清大字报海报（1024×1536），支持成片多帧抽取、音频文案提炼与按需一键生成

## 更新日志

详细版本更新记录请参阅 [CHANGELOG.md](./CHANGELOG.md)。
