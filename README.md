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

1. **素材库**：按组放入/上传 10 段左右直播切片  
2. **智能混剪**：一键成片（语音整句切割 → 介绍/价格结构 → 9:16 + 字幕 + BGM）  
3. **封面生成**：GPT Image 2 批量出封面  
4. **成片历史**：预览下载（任务写入本地 SQLite `backend/data/kuafa.db`，重启不丢）  

### 成片能力说明

- 画幅：**9:16 / 1080×1920**（抖音）  
- 切割：默认用 **必剪 ASR**（[bcut-asr](https://github.com/SocialSisterYi/bcut-asr) + 社区 412/result 修复）按整句切，避免切半个字；失败时回退 Whisper（需 OpenAI 兼容密钥）  
- 结构：前段介绍商品，中后段价格/促销口播拼接  
- 字幕：烧录口播字幕  
- BGM：读取 `backend/data/bgm/`，无文件时用简易垫乐  
- 封面：到「封面生成」用 GPT Image 2  

参考成片：`../完成版.mp4`
