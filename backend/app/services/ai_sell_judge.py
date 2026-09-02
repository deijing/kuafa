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
    block_key,
    deduplicate_consecutive_clips,
    extract_narrative_blocks,
    splice_opening,
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
    preferred_opening: NarrativeBlock | None = None,
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
            if clip.path == last.path and gap <= 0.45 and (clip.end - curr_clips[0].start) <= 18.0:
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

    # 2. 准备给大模型的候选清单；批量时把指定开场钉在池子前面，避免总选同一句开场白
    keep_n = min(30, len(candidate_blocks))
    pool = candidate_blocks[:keep_n]
    if preferred_opening is not None:
        pref_k = block_key(preferred_opening)
        pool = [b for b in pool if block_key(b) != pref_k]
        pool = [preferred_opening] + pool
        pool = pool[:keep_n]
    elif variant > 0 and len(pool) > 1:
        rot = variant % len(pool)
        pool = pool[rot:] + pool[:rot]
    id_map = {i: pool[i] for i in range(len(pool))}

    lines = []
    for i, b in enumerate(pool):
        role_label = "开场种草" if b.role == "intro" else ("破价逼单" if b.role == "price" else "细节讲解")
        lines.append(
            f"段落 {i} | 类型: {role_label} | 时长: {b.duration:.1f}秒\n完整口播: \"{b.text.strip()}\""
        )

    opening_rule = ""
    if preferred_opening is not None:
        opening_rule = (
            f"\n【开场强制差异化】这是批量成片第 {variant + 1} 条。"
            "selected_block_ids 的第一项必须是段落 0（已为本条指定的独特开场），"
            "不要换成其它更「常规」的开场白。"
        )
    elif variant > 0:
        opening_rule = (
            f"\n【开场差异化】variant={variant}，必须换一个与常见固定开场不同的 intro 段落作为第一条。"
        )

    system = (
        "你是抖音/快手短视频资深带货剪辑导演。你的任务是从主播的候选连贯话术段落中，"
        "挑选并编排 2~4 个最具转化力、叙事连贯的段落，组合成一条节奏紧凑、逻辑完整的爆款带货成片。"
        "必须确保每个选中的段落语意完整、表达有始有终，严禁一句话说到一半就中断。只输出 JSON，不要解释。"
    )
    user = f"""目标成片约 {target_seconds:.0f} 秒。差异化版本号 variant={variant}。
{opening_rule}

候选连贯话术段落：
{chr(10).join(lines)}

请挑选最能成交、最具吸引力的段落并排好顺序，黄金带货结构建议：
1. 开场前 3 秒吸引关注（痛点/钩子/新品引出段落）
2. 核心卖点深度种草（面料/版型/工艺/上身体验段落）
3. 破价福利与逼单收尾（价格机制/优惠/催单行动段落）

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

    return deduplicate_consecutive_clips(spliced), hooks[:4]


def collect_ai_candidates(
    clips: list[tuple[Path, list]],
    *,
    rules: ExtractRules,
) -> list[NarrativeBlock]:
    """从转写结果抽出供 AI 挑选的连贯话术叙事段落。"""
    rules = rules or ExtractRules()
    return extract_narrative_blocks(clips, rules=rules)


def ai_judge_material_coverage_plan(
    transcribed: list[tuple[Path, list]],
    *,
    target_seconds: float,
    rules: ExtractRules | None = None,
    variant: int = 0,
) -> tuple[list[EditClip], list[MagicCue]] | None:
    """
    针对用户选中的 N 个素材，使用 AI 大模型（DeepSeek）进行素材深度分析与全覆盖编排：
    1. 分别提取每个素材内部的连贯叙事段落（NarrativeBlock）。
    2. 将每个素材的口播内容整理并送入大模型，分析各个素材的卖点定位（Hook痛点/面料细节/版型展示/特价逼单）。
    3. 强制 AI 为每一个选定的素材挑选 1 段最精华连贯段落，并规划最佳叙事顺序，确保 100% 覆盖全部素材。
    4. 生成契合目标时长的成片方案和神奇大字。
    """
    if not transcribed or not has_openai_key():
        return None

    rules = rules or ExtractRules()
    num_materials = len(transcribed)
    if num_materials <= 1:
        candidates = collect_ai_candidates(transcribed, rules=rules)
        return ai_judge_sell_plan(candidates, target_seconds=target_seconds, variant=variant)

    from app.services.sell_planner import is_negative_segment

    # 1. 提取每个素材的连贯段落
    material_blocks_map: dict[int, list[NarrativeBlock]] = {}
    for idx, (path, segs) in enumerate(transcribed):
        m_blocks = extract_narrative_blocks([(path, segs)], rules=rules)
        if not m_blocks:
            valid_segs = [s for s in segs if s.text.strip() and not is_negative_segment(s.text, rules)]
            if valid_segs:
                m_blocks = [
                    NarrativeBlock(
                        path=path,
                        start=valid_segs[0].start,
                        end=valid_segs[-1].end,
                        text="".join(s.text.strip() for s in valid_segs),
                        clips=[EditClip(path, s.start, s.end, s.text.strip(), "intro") for s in valid_segs],
                        role="intro",
                        total_score=1.0,
                        source_index=idx,
                    )
                ]
            else:
                from app.services.ffmpeg_pipeline import probe_cached
                try:
                    p_info = probe_cached(path)
                    v_dur = p_info.duration
                except Exception:
                    v_dur = 5.0
                clip_dur = min(12.0, max(1.0, v_dur))
                m_blocks = [
                    NarrativeBlock(
                        path=path,
                        start=0.0,
                        end=clip_dur,
                        text="",
                        clips=[EditClip(path, 0.0, clip_dur, "", "filler")],
                        role="filler",
                        total_score=0.5,
                        source_index=idx,
                    )
                ]
        material_blocks_map[idx] = m_blocks

    # 2. 构造 AI 提示词
    mat_prompts = []
    budget_per_mat = target_seconds / num_materials

    for idx in range(num_materials):
        blocks = material_blocks_map[idx]
        p_name = transcribed[idx][0].name
        block_lines = []
        for b_i, b in enumerate(blocks[:4]):
            r_label = "开场种草" if b.role == "intro" else ("破价逼单" if b.role == "price" else "细节讲解")
            block_lines.append(f"  - 段落 {b_i} [{r_label} / 时长 {b.duration:.1f}s]: \"{b.text.strip()[:60]}\"")
        mat_prompts.append(f"【素材 #{idx+1} ({p_name})】:\n" + "\n".join(block_lines))

    system = (
        "你是抖音/快手短视频带货领域的顶级金牌剪辑导演。"
        "你的任务是为电商商家将所选素材快速组装成一条【快节奏、高转化、纯正讲品】的爆款带货短视频。"
        "【核心铁律 1 - 纯正高能讲品，拒绝拖沓废话】：成片必须节奏紧凑明快！严禁任何闲聊唠嗑、主播口水话或低信息量拖泥带水的内容。每一秒画面和口播都必须在硬核讲商品（面料材质/版型设计/上身效果/做工细节/优惠逼单）！"
        "【核心铁律 2 - 全素材精准覆盖】：每个素材（素材 #1 到 素材 #N）都必须在成片中出场（每个素材挑选 1 个最具讲品杀伤力的黄金连贯段落），绝不能漏掉任何一个素材！"
        "【核心铁律 3 - 句意完整绝对说完，严禁掐头断尾】：两个素材镜头衔接转换时，前一个素材的话必须完完整整讲完、自然收尾，绝对严禁话讲到一半突然被掐断切走！"
        "【核心铁律 4 - 严禁重复复读】：成片中绝对禁止同一句话说两遍或连续出现意思高度重合的车轱辘话。每一句话必须输出新的有效卖点。"
        "请分析各素材内容，排定最佳出场顺序并挑选各素材的最佳高能讲品段落。只输出 JSON。"
    )

    user = f"""目标成片总时长：约 {target_seconds:.0f} 秒（共 {num_materials} 个素材，每个素材平均分配约 {budget_per_mat:.1f} 秒）。
差异化版本号 variant={variant}。

待拼接的全部素材及其候选段落：
{chr(10).join(mat_prompts)}

编排要求：
1. 必须覆盖全部 {num_materials} 个素材，每个素材选出 1 个【纯讲品价值最高、无废话、每句话绝对完整说完且自然收尾】的最佳段落（严禁半截断句或吞字）。
2. 请按最佳带货叙事逻辑对这 {num_materials} 个素材进行排序（如：Hook痛点素材 ➔ 核心面料/工艺细节素材 ➔ 试穿/版型展示素材 ➔ 破价福利逼单素材）。
3. 给出 2～3 条契合当前画面的「神奇大字」爆款屏幕提示（每条 <= 8字）。

严格输出 JSON 格式：
{{
  "ordered_materials": [
    {{"material_index": 0, "block_index": 0, "role": "intro", "reason": "开场钩子"}},
    {{"material_index": 1, "block_index": 0, "role": "detail", "reason": "面料做工"}}
  ],
  "hooks": [
    {{"text": "主推爆款", "at_material_index": 0}},
    {{"text": "破价秒杀", "at_material_index": 1}}
  ]
}}
"""

    try:
        raw = chat_completions(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.55 + 0.1 * (variant % 3),
        )
        data = _parse_json(raw)
    except Exception:
        return None

    ordered = data.get("ordered_materials") or data.get("materials") or []
    if not isinstance(ordered, list) or not ordered:
        return None

    # 解析 AI 决策并验证全素材覆盖
    chosen_blocks: list[NarrativeBlock] = []
    included_materials: set[int] = set()

    for item in ordered:
        if not isinstance(item, dict):
            continue
        try:
            m_idx = int(item.get("material_index", item.get("material_id", -1)))
            b_idx = int(item.get("block_index", item.get("block_id", 0)))
        except (TypeError, ValueError):
            continue

        if m_idx in material_blocks_map and m_idx not in included_materials:
            blocks = material_blocks_map[m_idx]
            selected_b = blocks[b_idx] if 0 <= b_idx < len(blocks) else blocks[0]
            chosen_blocks.append(selected_b)
            included_materials.add(m_idx)

    # 兜底：如果 AI 遗漏了某些素材，自动把遗漏的素材按顺序补齐！
    for m_idx in range(num_materials):
        if m_idx not in included_materials:
            chosen_blocks.append(material_blocks_map[m_idx][0])
            included_materials.add(m_idx)

    if not chosen_blocks:
        return None

    # 展平为 EditClip 列表
    final_clips: list[EditClip] = []
    timeline_at = 0.0
    mat_start_times: dict[int, float] = {}

    for b in chosen_blocks:
        mat_start_times[b.source_index] = timeline_at
        final_clips.extend(b.clips)
        timeline_at += b.duration

    # 构建神奇大字
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
            at_m = h.get("at_material_index", 0)
            try:
                at_m_idx = int(at_m)
                at_time = mat_start_times.get(at_m_idx, 0.3) + 0.2
            except (TypeError, ValueError):
                at_time = 0.3 + len(hooks) * 10.0
            hooks.append(MagicCue(text=text, at=at_time, duration=1.8))

    if not hooks and final_clips:
        hooks.append(MagicCue(text="主推爆款", at=0.3, duration=2.0))

    return deduplicate_consecutive_clips(final_clips), hooks[:4]
