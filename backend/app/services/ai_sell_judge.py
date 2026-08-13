from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.openai_client import OpenAICompatError, chat_completions, has_openai_key
from app.services.sell_planner import EditClip, MagicCue, PRICE_RE


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
    clips: list[EditClip],
    *,
    target_seconds: float,
    variant: int = 0,
) -> tuple[list[EditClip], list[MagicCue]] | None:
    """
    用 OpenAI 兼容模型（推荐 DeepSeek V4 Pro）对口播句子做主观筛选，
    并给出成片「神奇大字」提示。无密钥或调用失败时返回 None，由调用方回退规则方案。
    """
    if not clips or not has_openai_key():
        return None

    # 候选过多时截断，避免超上下文；保留高价值句优先
    ranked = sorted(
        enumerate(clips),
        key=lambda it: (
            0 if it[1].role == "price" else 1 if it[1].role == "intro" else 2,
            -(it[1].end - it[1].start),
        ),
    )
    keep_n = min(80, len(ranked))
    pool = ranked[:keep_n]
    id_map = {i: clips[orig_i] for i, (orig_i, _) in enumerate(pool)}

    lines = []
    for i, (_, clip) in enumerate(pool):
        lines.append(
            f"{i}|{clip.role}|{clip.end - clip.start:.1f}s|{clip.text.strip()[:80]}"
        )

    system = (
        "你是抖音带货短视频资深剪辑导演。根据口播候选句，主观判断哪些该保留、"
        "顺序如何更有转化力。只输出 JSON，不要解释。"
    )
    user = f"""目标成片约 {target_seconds:.0f} 秒。差异化版本号 variant={variant}（注意：不同视频或多主播生成时，第一句开场白/钩子句必须保持多样性与新鲜感，避免每条视频都用完全相同的开头）。

候选句（格式：id|角色|时长|文本）：
{chr(10).join(lines)}

请主观挑选最能成交的句子，结构建议：前段种草介绍 → 中后段价格/逼单。
如果 variant>0 或生成多条视频，请特别注意换一个不同的种草/吸引注意力的开场句（intro）作为首句。
总时长尽量接近目标（允许 0.75x～1.15x）。

同时给出 2～4 条「神奇大字」屏幕提示（超短、有冲击力，适合抖音弹字，如「破价！」「仅剩100件」「今天最后一波」），
每条不超过 8 个字，不要标点堆砌。

严格输出 JSON：
{{
  "selected_ids": [0, 3, 5],
  "hooks": [
    {{"text": "破价！", "after_id": 0}},
    {{"text": "手慢无", "after_id": 5}}
  ]
}}
selected_ids 必须来自候选 id，按成片播放顺序排列；after_id 表示该大字出现在该句开始时。
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

    selected_ids = data.get("selected_ids") or data.get("ids") or []
    if not isinstance(selected_ids, list) or not selected_ids:
        return None

    plan: list[EditClip] = []
    total = 0.0
    seen: set[int] = set()
    for item in selected_ids:
        try:
            idx = int(item)
        except (TypeError, ValueError):
            continue
        if idx in seen or idx not in id_map:
            continue
        clip = id_map[idx]
        dur = clip.end - clip.start
        if total + dur > target_seconds * 1.2 and total >= target_seconds * 0.7:
            break
        plan.append(clip)
        seen.add(idx)
        total += dur

    if not plan:
        return None

    # 时间轴：按 plan 顺序累计
    timeline_at: dict[int, float] = {}
    cursor = 0.0
    for i, clip in enumerate(plan):
        # 找到该 clip 在 pool 中的 id
        pool_id = next((pid for pid, c in id_map.items() if c is clip), i)
        timeline_at[pool_id] = cursor
        cursor += max(0.2, clip.end - clip.start)

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
            after = h.get("after_id")
            at = 0.3
            try:
                after_i = int(after)
                if after_i in timeline_at:
                    at = timeline_at[after_i] + 0.15
                elif 0 <= after_i < len(plan):
                    # 若模型把 after_id 当成 selected 序号
                    t = 0.0
                    for j in range(after_i):
                        t += max(0.2, plan[j].end - plan[j].start)
                    at = t + 0.15
            except (TypeError, ValueError):
                at = 0.3 + len(hooks) * 8.0
            hooks.append(MagicCue(text=text, at=at, duration=1.8))

    if not hooks:
        # 模型没给大字时：从价格句启发式补
        t = 0.0
        for clip in plan:
            if clip.role == "price" or PRICE_RE.search(clip.text):
                tip = "破价！" if "价" in clip.text or "元" in clip.text else "马上拍"
                hooks.append(MagicCue(text=tip[:8], at=t + 0.2, duration=1.8))
                if len(hooks) >= 3:
                    break
            t += max(0.2, clip.end - clip.start)

    return plan, hooks[:4]


def collect_ai_candidates(
    clips: list[tuple[Path, list]],
    *,
    rules,
) -> list[EditClip]:
    """从转写结果抽出可给 AI 判断的候选句（复用规则角色标注）。"""
    from app.services.sell_planner import (
        DETAIL_RE,
        INTRO_RE,
        PRICE_RE as _PRICE,
        ExtractRules,
        _is_sparse_or_stalled,
    )

    rules = rules or ExtractRules()
    items: list[EditClip] = []
    for path, segs in clips:
        for seg in segs:
            if not seg.text.strip() or seg.end <= seg.start:
                continue
            if rules.silence and _is_sparse_or_stalled(seg):
                continue
            role = "filler"
            if _PRICE.search(seg.text):
                role = "price" if rules.bargain else "filler"
            elif INTRO_RE.search(seg.text):
                role = "intro"
            if role == "intro" and not rules.detail and DETAIL_RE.search(seg.text):
                role = "filler"
            items.append(
                EditClip(
                    path=path,
                    start=seg.start,
                    end=seg.end,
                    text=seg.text.strip(),
                    role=role,
                )
            )
    return items
