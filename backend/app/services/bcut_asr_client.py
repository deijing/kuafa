"""
必剪 ASR 客户端（基于 SocialSisterYi/bcut-asr，并合入社区修复）

修复来源：
1. Issue/PR #13：412 Precondition Failed → 补齐浏览器 User-Agent / Cache-Control
2. PR #19：轮询 state=RUNNING 时 result 字段可为空
3. 评论区 ResourceFileType：确保 resource_file_type 正确上传

参考：https://github.com/SocialSisterYi/bcut-asr
"""

from __future__ import annotations

import logging
import time
from enum import Enum
from pathlib import Path
from typing import Literal, Optional

import requests
from pydantic import BaseModel

from app.services.ffmpeg_pipeline import run_cmd

logger = logging.getLogger(__name__)

API_BASE_URL = "https://member.bilibili.com/x/bcut/rubick-interface"
API_REQ_UPLOAD = f"{API_BASE_URL}/resource/create"
API_COMMIT_UPLOAD = f"{API_BASE_URL}/resource/create/complete"
API_CREATE_TASK = f"{API_BASE_URL}/task"
API_QUERY_RESULT = f"{API_BASE_URL}/task/result"

SUPPORT_FMT = ("flac", "aac", "m4a", "mp3", "wav")

# 艾叔/社区修复：412 需要伪装浏览器请求头
BCUT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Cache-Control": "no-cache",
    "Origin": "https://member.bilibili.com",
    "Referer": "https://member.bilibili.com/",
}


class APIError(RuntimeError):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(f"Bcut API error {code}: {message}")
        self.code = code
        self.message = message


class ASRDataWords(BaseModel):
    label: str
    start_time: int
    end_time: int


class ASRDataSeg(BaseModel):
    start_time: int
    end_time: int
    transcript: str
    words: list[ASRDataWords] = []


class ASRData(BaseModel):
    utterances: list[ASRDataSeg] = []
    version: str = ""

    def has_data(self) -> bool:
        return len(self.utterances) > 0


class ResourceCreateRspSchema(BaseModel):
    resource_id: str
    title: str
    type: int
    in_boss_key: str
    size: int
    upload_urls: list[str]
    upload_id: str
    per_size: int


class ResourceCompleteRspSchema(BaseModel):
    resource_id: str
    download_url: str


class TaskCreateRspSchema(BaseModel):
    resource: str
    result: str
    task_id: str


class ResultStateEnum(int, Enum):
    STOP = 0
    RUNING = 1
    ERROR = 3
    COMPLETE = 4


class ResultRspSchema(BaseModel):
    task_id: str
    result: Optional[str] = None  # PR#19: running 时可能缺失
    remark: str = ""
    state: ResultStateEnum

    def parse(self) -> ASRData:
        if not self.result:
            return ASRData()
        return ASRData.model_validate_json(self.result)


def extract_audio_aac(media_file: Path) -> bytes:
    """用本机 ffmpeg 抽音轨为 aac（不依赖 ffmpeg-python）。"""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".aac", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        run_cmd(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(media_file),
                "-vn",
                "-ac",
                "1",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(out),
            ],
            timeout=180,
        )
        return out.read_bytes()
    finally:
        out.unlink(missing_ok=True)


class BcutASR:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(BCUT_HEADERS)
        self.sound_bin: bytes | None = None
        self.sound_fmt: str | None = None
        self.sound_name: str | None = None
        self.task_id: str | None = None
        self.__etags: list[str] = []
        self.__in_boss_key = ""
        self.__resource_id = ""
        self.__upload_id = ""
        self.__upload_urls: list[str] = []
        self.__per_size = 0
        self.__clips = 0
        self.__download_url = ""

    def set_data(
        self,
        *,
        file: Path | None = None,
        raw_data: bytes | None = None,
        data_fmt: Literal["flac", "aac", "m4a", "mp3", "wav"] | None = None,
    ) -> None:
        if file is not None:
            suffix = (data_fmt or file.suffix.lstrip(".")).lower()
            if suffix in SUPPORT_FMT:
                self.sound_bin = file.read_bytes()
                self.sound_fmt = suffix
                self.sound_name = file.name
            else:
                logger.info("非标准音频，ffmpeg 转 aac…")
                self.sound_bin = extract_audio_aac(file)
                self.sound_fmt = "aac"
                self.sound_name = f"{int(time.time())}.aac"
        elif raw_data is not None and data_fmt:
            self.sound_bin = raw_data
            self.sound_fmt = data_fmt
            self.sound_name = f"{int(time.time())}.{data_fmt}"
        else:
            raise ValueError("未设置音频数据")
        if self.sound_fmt not in SUPPORT_FMT:
            raise TypeError(f"不支持格式: {self.sound_fmt}")
        logger.info("加载文件成功: %s", self.sound_name)

    def upload(self) -> None:
        if not self.sound_bin or not self.sound_fmt or not self.sound_name:
            raise ValueError("未设置音频数据")
        resp = self.session.post(
            API_REQ_UPLOAD,
            data={
                "type": 2,
                "name": self.sound_name,
                "size": len(self.sound_bin),
                "resource_file_type": self.sound_fmt,  # 必填
                "model_id": 7,
            },
            timeout=60,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("code"):
            raise APIError(payload["code"], payload.get("message", ""))
        data = ResourceCreateRspSchema.model_validate(payload["data"])
        self.__in_boss_key = data.in_boss_key
        self.__resource_id = data.resource_id
        self.__upload_id = data.upload_id
        self.__upload_urls = data.upload_urls
        self.__per_size = data.per_size
        self.__clips = len(data.upload_urls)
        logger.info(
            "申请上传成功 %sKB / %s 分片",
            data.size // 1024,
            self.__clips,
        )
        self.__upload_part()
        self.__commit_upload()

    def __upload_part(self) -> None:
        assert self.sound_bin is not None
        for clip in range(self.__clips):
            start = clip * self.__per_size
            end = (clip + 1) * self.__per_size
            resp = self.session.put(
                self.__upload_urls[clip],
                data=self.sound_bin[start:end],
                timeout=120,
            )
            resp.raise_for_status()
            etag = resp.headers.get("Etag") or resp.headers.get("ETag") or ""
            self.__etags.append(etag)
            logger.info("分片 %s 上传成功", clip)

    def __commit_upload(self) -> None:
        resp = self.session.post(
            API_COMMIT_UPLOAD,
            data={
                "in_boss_key": self.__in_boss_key,
                "resource_id": self.__resource_id,
                "etags": ",".join(self.__etags),
                "upload_id": self.__upload_id,
                "model_id": 7,
            },
            timeout=60,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("code"):
            raise APIError(payload["code"], payload.get("message", ""))
        data = ResourceCompleteRspSchema.model_validate(payload["data"])
        self.__download_url = data.download_url
        logger.info("提交上传成功")

    def create_task(self) -> str:
        resp = self.session.post(
            API_CREATE_TASK,
            json={"resource": self.__download_url, "model_id": "7"},
            timeout=60,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("code"):
            raise APIError(payload["code"], payload.get("message", ""))
        data = TaskCreateRspSchema.model_validate(payload["data"])
        self.task_id = data.task_id
        logger.info("任务已创建: %s", self.task_id)
        return self.task_id

    def result(self, task_id: str | None = None) -> ResultRspSchema:
        resp = self.session.get(
            API_QUERY_RESULT,
            params={"model_id": 7, "task_id": task_id or self.task_id},
            timeout=60,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("code"):
            raise APIError(payload["code"], payload.get("message", ""))
        return ResultRspSchema.model_validate(payload["data"])


def recognize_media(
    media: Path,
    *,
    interval: float = 2.0,
    timeout: float = 600.0,
) -> ASRData:
    """上传媒体到必剪并返回带时间戳的字幕断句。"""
    asr = BcutASR()
    asr.set_data(file=media)
    asr.upload()
    asr.create_task()
    started = time.time()
    while True:
        task = asr.result()
        if task.state == ResultStateEnum.COMPLETE:
            data = task.parse()
            if not data.has_data():
                raise RuntimeError("必剪识别完成但没有字幕数据")
            return data
        if task.state == ResultStateEnum.ERROR:
            raise RuntimeError(f"必剪识别失败: {task.remark}")
        if time.time() - started > timeout:
            raise TimeoutError("必剪识别超时")
        time.sleep(interval)
