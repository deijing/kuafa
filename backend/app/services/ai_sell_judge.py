from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.services.openai_client import OpenAICompatError, chat_completions, has_openai_key
from app.services.sell_planner import (
    EditClip,
    ExtractRules,
    MagicCue,
    NarrativeBlock,
    PRICE_RE,
    extract_narrative_blocks,
)


_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _parse_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    match = _JSON_RE.search(text)
    if not match:
        raise ValueError("模型未返回 JSON")
    return json.loads(match.group(0))


def ai_judge_sell_plan(
    blocks_or_clips: list[NarrativeBlock] | list[EditClip],
    *,
    target_seconds: float,
    variant: int = 0,
) -> tuple[list[EditClip], list[MagicCue]] | None:
    """
    用 OpenAI 兼容模型（推荐 DeepSeek V4 Pro）从连贯话术叙事段落中做导演级主观精选与编排，
    并给出成片「神奇大字」提示。确保成片每个段落意思完整、表达连贯，有始有终。
    无密钥或调用失败时返回 None，由调用方回退规则方案。
    """
    if not blocks_or_clips or not has_openai_key():
        return None

    # 1. 统一转换为 NarrativeBlock 列表
    candidate_blocks: list[NarrativeBlock] = []
    if isinstance(blocks_or_clips[0], NarrativeBlock):
        candidate_blocks = list(blocks_or_clips)  # type: ignore
    else:
        # 如果传入的是原始 EditClip，按文件名与连续性做快速聚类
        curr_clips: list[EditClip] = []
        for clip in blocks_or_clips:  # type: ignore
            if not curr_clips:
                curr_clips.append(clip)
                continue
            last = curr_clips[-1]
            gap = clip.start - last.end
            if clip.path == last.path and gap <= 1.8 and (clip.end - curr_clips[0].start) <= 18.0:
                curr_clips.append(clip)
            else:
                b_text = "".join(c.text for c in curr_clips)
                candidate_blocks.append(
                    NarrativeBlock(
                        path=curr_clips[0].path,
                        start=curr_clips[0].start,
                        end=curr_clips[-1].end,
                        text=b_text,
                        clips=list(curr_clips),
                        role=curr_clips[0].role,
                        total_score=len(curr_clips),
                    )
                )
                curr_clips = [clip]
        if curr_clips:
            b_text = "".join(c.text for c in curr_clips)
            candidate_blocks.append(
                NarrativeBlock(
                    path=curr_clips[0].path,
                    start=curr_clips[0].start,
                    end=curr_clips[-1].end,
                    text=b_text,
                    clips=list(curr_clips),
                    role=curr_clips[0].role,
                    total_score=len(curr_clips),
                )
            )

    if not candidate_blocks:
        return None

    # 2. 准备给大模型的候选清单（保留上下文顺序与完整话术文本）
    # 限制候选数量避免超上下文
    keep_n = min(30, len(candidate_blocks))
    pool = candidate_blocks[:keep_n]
    id_map = {i: pool[i] for i in range(len(pool))}

    lines = []
    for i, b in enumerate(pool):
        role_label = "开场种草" if b.role == "intro" else ("破价逼单" if b.role == "price" else "细节讲解")
        lines.append(
            f"段落 {i} | 类型: {role_label} | 时长: {b.duration:.1f}秒\n完整口播: \"{b.text.strip()}\""
        )

    system = (
        "你是抖音/快手短视频资深带货剪辑导演。你的任务是从主播的候选连贯话术段落中，"
        "挑选并编排 2~4 个最具转化力、叙事连贯的段落，组合成一条节奏紧凑、逻辑完整的爆款带货成片。"
        "必须确保每个选中的段落语意完整、表达有始有终，严禁一句话说到一半就中断。只输出 JSON，不要解释。"
    )
    user = f"""目标成片约 {target_seconds:.0f} 秒。差异化版本号 variant={variant}。

候选连贯话术段落：
{chr(10).join(lines)}

请挑选最能成交、最具吸引力的段落并排好顺序，黄金带货结构建议：
1. 开场前 3 秒吸引关注（痛点/钩子/新品引出段落）
2. 核心卖点深度种草（面料/版型/工艺/上身体验段落）
3. 破价福利与逼单收尾（价格机制/优惠/催单行动段落）

如果 variant>0，请特别注意换一个不同的开场段落（intro），保持多条视频的多样性。
总时长尽量接近 {target_seconds:.0f} 秒（允许 0.75x～1.15x）。

同时给出 2～3 条「神奇大字」屏幕提示（超短、有冲击力，适合抖音顶部弹字，如「主推爆款」「闭眼入」「破价秒杀」），每条不超过 8 个字。

严格输出 JSON 格式：
{{
  "selected_block_ids": [0, 2, 4],
  "hooks": [
    {{"text": "主推爆款", "after_block_id": 0}},
    {{"text": "破价！", "after_block_id": 4}}
  ]
}}
selected_block_ids 必须来自候选段落编号，按播放顺序排列；after_block_id 表示该大字出现在该段落开始时。
"""

    try:
        raw = chat_completions(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.55 + 0.12 * (variant % 3),
        )
        data = _parse_json(raw)
    except (OpenAICompatError, ValueError, json.JSONDecodeError, KeyError, TypeError):
        return None

    selected_ids = (
        data.get("selected_block_ids")
        or data.get("selected_ids")
        or data.get("ids")
        or []
    )
    if not isinstance(selected_ids, list) or not selected_ids:
        return None

    plan_blocks: list[NarrativeBlock] = []
    plan_block_ids: list[int] = []
    total = 0.0
    seen: set[int] = set()

    for item in selected_ids:
        try:
            idx = int(item)
        except (TypeError, ValueError):
            continue
        if idx in seen or idx not in id_map:
            continue
        block = id_map[idx]
        dur = block.duration
        if total + dur > target_seconds * 1.25 and total >= target_seconds * 0.7:
            break
        plan_blocks.append(block)
        plan_block_ids.append(idx)
        seen.add(idx)
        total += dur

    if not plan_blocks:
        return None

    # 展平为 EditClip 列表，段落内部所有单句严格连续完整
    final_clips: list[EditClip] = []
    block_start_times: dict[int, float] = {}
    current_time = 0.0

    for i, b in enumerate(plan_blocks):
        b_id = plan_block_ids[i]
        block_start_times[b_id] = current_time
        final_clips.extend(b.clips)
        current_time += b.duration

    # 构建神奇大字时间戳
    hooks: list[MagicCue] = []
    raw_hooks = data.get("hooks") or []
    if isinstance(raw_hooks, list):
        for h in raw_hooks:
            if not isinstance(h, dict):
                continue
            text = str(h.get("text") or "").strip()
            text = re.sub(r"\s+", "", text)[:8]
            if not text:
                continue
            after = h.get("after_block_id", h.get("after_id"))
            at = 0.3
            try:
                after_i = int(after)
                if after_i in block_start_times:
                    at = block_start_times[after_i] + 0.2
                elif 0 <= after_i < len(plan_blocks):
                    # 若模型使用了序号而不是原 id
                    t = 0.0
                    for j in range(after_i):
                        t += plan_blocks[j].duration
                    at = t + 0.2
            except (TypeError, ValueError):
                at = 0.3 + len(hooks) * 8.0
            hooks.append(MagicCue(text=text, at=at, duration=1.8))

    if not hooks and final_clips:
        # 模型没给大字时：启发式补
        t = 0.0
        for clip in final_clips:
            if clip.role == "price" or PRICE_RE.search(clip.text):
                tip = "破价！" if "价" in clip.text or "元" in clip.text else "马上抢"
                hooks.append(MagicCue(text=tip[:8], at=t + 0.2, duration=1.8))
                if len(hooks) >= 2:
                    break
            t += max(0.2, clip.end - clip.start)

    return final_clips, hooks[:4]


def collect_ai_candidates(
    clips: list[tuple[Path, list]],
    *,
    rules: ExtractRules,
) -> list[NarrativeBlock]:
    """从转写结果抽出供 AI 挑选的连贯话术叙事段落。"""
    rules = rules or ExtractRules()
    return extract_narrative_blocks(clips, rules=rules)
