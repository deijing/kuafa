from __future__ import annotations

import hashlib
import re
import shutil
from pathlib import Path

from app.config import get_materials_dir, settings
from app.models import GroupOut, MaterialOut
from app.services.ffmpeg_pipeline import (
    format_duration,
    generate_thumbnail,
    probe_cached,
)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _id_for(path: Path) -> str:
    return hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:16]


def sanitize_group_name(name: str) -> str:
    cleaned = INVALID_NAME.sub("", name.strip())
    cleaned = cleaned.strip(" .")
    if not cleaned:
        raise ValueError("组名无效")
    if cleaned in {".", ".."}:
        raise ValueError("组名无效")
    return cleaned


def _material_from_file(path: Path, group_id: str, group_name: str) -> MaterialOut | None:
    try:
        info = probe_cached(path)
    except Exception:
        return None
    mid = _id_for(path)
    thumb = settings.thumbs_dir / f"{mid}.jpg"
    try:
        generate_thumbnail(
            path, thumb, at_seconds=min(2.0, max(0.1, info.duration / 5))
        )
        thumb_url = f"/api/thumbs/{mid}.jpg"
    except Exception:
        thumb_url = None
    return MaterialOut(
        id=mid,
        group_id=group_id,
        group_name=group_name,
        filename=path.name,
        title=path.name,
        path=str(path.resolve()),
        duration=info.duration,
        duration_label=format_duration(info.duration),
        width=info.width,
        height=info.height,
        size_bytes=path.stat().st_size,
        thumb_url=thumb_url,
        source="library",
    )


def list_groups(*, include_materials: bool = True) -> list[GroupOut]:
    root = get_materials_dir()
    root.mkdir(parents=True, exist_ok=True)
    groups: list[GroupOut] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        gid = _id_for(entry)
        materials: list[MaterialOut] = []
        video_files = [
            f
            for f in sorted(entry.iterdir(), key=lambda p: p.name.lower())
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS
        ]
        if include_materials:
            for file in video_files:
                item = _material_from_file(file, gid, entry.name)
                if item:
                    materials.append(item)
            count = len(materials)
        else:
            count = len(video_files)
        groups.append(
            GroupOut(
                id=gid,
                name=entry.name,
                path=str(entry.resolve()),
                material_count=count,
                materials=materials if include_materials else [],
            )
        )
    return groups


def list_materials() -> list[MaterialOut]:
    items: list[MaterialOut] = []
    for group in list_groups(include_materials=True):
        items.extend(group.materials)
    return items


def get_group(group_id: str) -> GroupOut:
    for group in list_groups(include_materials=True):
        if group.id == group_id:
            return group
    raise KeyError("素材组不存在")


def get_materials_by_ids(ids: list[str]) -> list[MaterialOut]:
    by_id = {m.id: m for m in list_materials()}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise KeyError(f"素材不存在: {', '.join(missing)}")
    return [by_id[i] for i in ids]


def create_group(name: str) -> GroupOut:
    safe = sanitize_group_name(name)
    dest = get_materials_dir() / safe
    if dest.exists():
        raise ValueError(f"组「{safe}」已存在")
    dest.mkdir(parents=True, exist_ok=False)
    return GroupOut(
        id=_id_for(dest),
        name=safe,
        path=str(dest.resolve()),
        material_count=0,
        materials=[],
    )


def rename_group(group_id: str, name: str) -> GroupOut:
    safe = sanitize_group_name(name)
    group = get_group(group_id)
    src = Path(group.path)
    dest = src.parent / safe
    if dest.exists() and dest.resolve() != src.resolve():
        raise ValueError(f"组「{safe}」已存在")
    src.rename(dest)
    return get_group(_id_for(dest))


def save_upload(filename: str, data: bytes, group_id: str) -> MaterialOut:
    group = get_group(group_id)
    safe = Path(filename).name
    dest = Path(group.path) / safe
    if dest.exists():
        stem, suffix = dest.stem, dest.suffix
        dest = Path(group.path) / f"{stem}_{_id_for(dest)}{suffix}"
    dest.write_bytes(data)
    item = _material_from_file(dest, group.id, group.name)
    if not item:
        raise RuntimeError("上传成功但无法读取素材信息")
    return item


def seed_demo_group_from_case() -> None:
    """若 input 为空且存在上级「案例」目录，则复制为演示组。"""
    root = get_materials_dir()
    if any(root.iterdir()):
        return
    case_dir = settings.project_root / "案例"
    if not case_dir.exists():
        return
    demo = root / "演示主播-案例导入"
    demo.mkdir(parents=True, exist_ok=True)
    for file in case_dir.iterdir():
        if file.is_file() and file.suffix.lower() in VIDEO_EXTS:
            target = demo / file.name
            if not target.exists():
                shutil.copy2(file, target)
