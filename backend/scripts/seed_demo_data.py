"""Seed realistic demo batch jobs and materials for testing."""

import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
import uuid

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_materials_dir, settings
from app.models import JobOut, JobStatus, CoverResult
from app.services import db as store
from app.services.materials import list_groups

def run():
    print("🚀 开始生成测试数据...")
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)
    settings.thumbs_dir.mkdir(parents=True, exist_ok=True)
    materials_dir = get_materials_dir()
    materials_dir.mkdir(parents=True, exist_ok=True)

    # 1. 生成 1 段 9:16 极速样片 MP4
    base_demo_mp4 = settings.outputs_dir / "base_demo.mp4"
    if not base_demo_mp4.exists():
        print("  - 生成基础测试视频...")
        os.system(
            f'{settings.ffmpeg_bin} -y -f lavfi -i testsrc=size=720x1280:rate=25 '
            f'-f lavfi -i sine=frequency=523:duration=4 -c:v libx264 -c:a aac -t 4 -pix_fmt yuv420p "{base_demo_mp4}" >/dev/null 2>&1'
        )

    # 生成 1 张基础封面 thumb
    base_thumb_jpg = settings.thumbs_dir / "base_thumb.jpg"
    if not base_thumb_jpg.exists():
        os.system(
            f'{settings.ffmpeg_bin} -y -f lavfi -i color=c=0x1e293b:s=720x1280:d=1 '
            f'-frames:v 1 "{base_thumb_jpg}" >/dev/null 2>&1'
        )

    # 2. 生成 3 个素材组测试文件夹及样片素材
    groups_spec = [
        ("01_法式复古连衣裙", ["镜头01_面料特写.mp4", "镜头02_模特上身.mp4", "镜头03_走动展示.mp4"]),
        ("02_美式宽松连帽卫衣", ["镜头01_正面展示.mp4", "镜头02_帽檐细节.mp4", "镜头03_袖口刺绣.mp4", "镜头04_上身版型.mp4"]),
        ("03_爆款清凉防晒外套", ["镜头01_透气防紫外线.mp4", "镜头02_轻薄折叠.mp4", "镜头03_户外穿搭.mp4"]),
    ]

    for g_name, clips in groups_spec:
        g_dir = materials_dir / g_name
        g_dir.mkdir(parents=True, exist_ok=True)
        for clip in clips:
            c_path = g_dir / clip
            if not c_path.exists() and base_demo_mp4.exists():
                c_path.write_bytes(base_demo_mp4.read_bytes())

    # 重新加载素材
    list_groups()

    # 3. 构造 3 个独立批次测试数据
    now = datetime.now(timezone.utc)
    
    batches = [
        {
            "batch_id": "batch_20260818_100000_3item",
            "time_offset_min": 360,
            "group_name": "经典复古牛仔裤",
            "count": 3,
            "titles": [
                "高腰垂感直筒牛仔裤 · 显瘦显腿长",
                "高腰垂感直筒牛仔裤 · 弹力不紧绷",
                "高腰垂感直筒牛仔裤 · 百搭水洗浅蓝",
            ],
            "durations": [36.0, 41.5, 39.0],
        },
        {
            "batch_id": "batch_20260818_112000_5item",
            "time_offset_min": 280,
            "group_name": "莫代尔冰丝T恤",
            "count": 5,
            "titles": [
                "无痕冰丝短袖T恤 · 凉感透气不贴身",
                "无痕冰丝短袖T恤 · 显白纯色多色可选",
                "无痕冰丝短袖T恤 · 抗皱不起球",
                "无痕冰丝短袖T恤 · 版型立体遮小肚腩",
                "无痕冰丝短袖T恤 · 拍1发3专柜品质",
            ],
            "durations": [32.0, 35.0, 38.0, 34.5, 37.0],
        },
        {
            "batch_id": "batch_20260818_121000_4item",
            "time_offset_min": 220,
            "group_name": "爆款复古老爹鞋",
            "count": 4,
            "titles": [
                "轻量增高老爹鞋 · 踩屎感超舒适",
                "轻量增高老爹鞋 · 隐形增高5cm",
                "轻量增高老爹鞋 · 防滑耐磨运动通勤",
                "轻量增高老爹鞋 · 复古撞色潮流出街",
            ],
            "durations": [40.0, 42.0, 38.5, 45.0],
        },
        {
            "batch_id": "batch_20260818_130000_7item",
            "time_offset_min": 150,
            "group_name": "羊绒针织开衫",
            "count": 7,
            "titles": [
                f"软糯羊绒开衫 · 温柔初秋穿搭 #{i+1}" for i in range(7)
            ],
            "durations": [41.0 + i for i in range(7)],
        },
        {
            "batch_id": "batch_20260818_134500_10item",
            "time_offset_min": 100,
            "group_name": "三合一户外冲锋衣",
            "count": 10,
            "titles": [
                f"暴雨级防水防风冲锋衣 · 登山露营必备 #{i+1}" for i in range(10)
            ],
            "durations": [45.0 + (i % 8) for i in range(10)],
        },
        {
            "batch_id": "batch_20260818_143000_6item",
            "time_offset_min": 60,
            "group_name": "法式复古连衣裙",
            "count": 6,
            "titles": [
                "法式碎花连衣裙 · 显瘦高腰A字版型",
                "法式碎花连衣裙 · 清爽透气不挑身材",
                "法式碎花连衣裙 · 垂感十足优雅随性",
                "法式碎花连衣裙 · 浪漫收腰遮肉神器",
                "法式碎花连衣裙 · 夏季穿搭炸街爆款",
                "法式碎花连衣裙 · 现货拍下顺丰包邮",
            ],
            "durations": [38.5, 42.0, 45.2, 40.8, 44.0, 46.5],
        },
        {
            "batch_id": "batch_20260818_151500_8item",
            "time_offset_min": 30,
            "group_name": "美式宽松连帽卫衣",
            "count": 8,
            "titles": [
                "重磅纯棉连帽卫衣 · 显白百搭情侣款",
                "重磅纯棉连帽卫衣 · 舒适落肩慵懒风",
                "重磅纯棉连帽卫衣 · 加绒加厚御寒保暖",
                "重磅纯棉连帽卫衣 · 潮流印花街头穿搭",
                "重磅纯棉连帽卫衣 · 宽松大码遮肉显瘦",
                "重磅纯棉连帽卫衣 · 明星同款高级版型",
                "重磅纯棉连帽卫衣 · 水洗复古不褪色",
                "重磅纯棉连帽卫衣 · 拍1发2限时特惠",
            ],
            "durations": [45.0, 48.2, 42.6, 50.1, 46.8, 44.5, 47.0, 49.3],
        },
        {
            "batch_id": "batch_20260818_160500_20item",
            "time_offset_min": 5,
            "group_name": "爆款清凉防晒外套",
            "count": 20,
            "titles": [
                f"清凉UPF50+防晒衣 · 夏季户外必备 #{i+1}"
                for i in range(20)
            ],
            "durations": [35.0 + (i % 15) for i in range(20)],
        },
    ]

    store.ensure_db()
    inserted_count = 0

    for b in batches:
        created_time = (now - timedelta(minutes=b["time_offset_min"])).isoformat()
        print(f"  - 写入批次: {b['batch_id']} ({b['count']}条视频)...")
        for i in range(b["count"]):
            job_id = uuid.uuid4().hex[:12]
            title = b["titles"][i]
            dur = b["durations"][i]

            # 创建对应的测试 mp4 实体文件
            job_mp4 = settings.outputs_dir / f"{job_id}.mp4"
            if base_demo_mp4.exists() and not job_mp4.exists():
                job_mp4.write_bytes(base_demo_mp4.read_bytes())

            # 创建 3 张配套封面
            covers = []
            for c_idx in range(3):
                cover_id = f"c_{job_id}_{c_idx}"
                cover_jpg = settings.thumbs_dir / f"{cover_id}.jpg"
                if base_thumb_jpg.exists() and not cover_jpg.exists():
                    cover_jpg.write_bytes(base_thumb_jpg.read_bytes())
                covers.append(
                    CoverResult(
                        id=cover_id,
                        url=f"/api/thumbs/{cover_id}.jpg",
                        remote_url=None,
                        headline=f"✨ {title.split('·')[0].strip()} #{c_idx + 1}",
                    )
                )

            job = JobOut(
                id=job_id,
                batch_id=b["batch_id"],
                status=JobStatus.succeeded,
                progress=100,
                message="成片完成",
                created_at=created_time,
                finished_at=created_time,
                output_url=f"/api/outputs/{job_id}.mp4",
                output_path=str(job_mp4.resolve()),
                duration=dur,
                material_ids=[],
                group_id=None,
                error=None,
                headline=title,
                covers=covers,
            )
            store.upsert_generate_job(job)
            inserted_count += 1

    print(f"✅ 成功写入 3 个独立批次共 {inserted_count} 条测试数据！")

if __name__ == "__main__":
    run()
