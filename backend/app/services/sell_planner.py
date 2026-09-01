from __future__ import annotations

import random
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from app.services.transcription import TranscriptSegment

PRICE_RE = re.compile(
    r"(元|块钱|块|价格|只要|特价|秒杀|清仓|包邮|到手|券后|拍下|链接|优惠|打折|便宜|福利|逼单|库存|马上|下单|带走|拍一发|立省|省下|米)"
)
INTRO_RE = re.compile(
    r"(这款|今天|给大家|介绍|看看|面料|上身|版型|颜色|新款|搭配|质感|细节|推荐|特写|展示|姐妹们|宝宝们|看过来|主推|爆款|第一款|首发)"
)
DETAIL_RE = re.compile(
    r"(面料|上身|版型|颜色|质感|细节|特写|展示|搭配|摸起来|手感|透气|显瘦|亲肤|柔软|耐穿|不起球|不掉色|做工|走线|刺绣|剪裁)"
)

DEFAULT_LIVE_PITCH_WORDS = (
    "1号链接", "一号链接", "2号链接", "二号链接", "3号链接", "三号链接",
    "4号链接", "四号链接", "5号链接", "五号链接", "几号链接", "看几号",
    "小黄车", "下方小黄车", "左下角小黄车", "右下角小黄车", "去拍", "抓紧去拍", "赶紧去拍", "下方链接",
    "关注主播", "给主播点点关注", "点关注不迷路", "点个关注", "点点关注",
    "粉丝团", "加入粉丝团", "进粉丝团", "灯牌", "粉丝灯牌", "加个灯牌",
    "公屏", "公屏扣", "扣1", "扣666", "连麦", "榜一", "榜二", "榜三大哥",
    "主播身高", "主播体重", "穿几码", "客服", "私信客服",
)


@dataclass
class EditClip:
    path: Path
    start: float
    end: float
    text: str
    role: str  # intro | price | filler


@dataclass
class MagicCue:
    """成片「神奇大字」提示（顶部弹字动效）。"""

    text: str
    at: float  # 成片时间轴起点（秒）
    duration: float = 1.8


@dataclass(frozen=True)
class ExtractRules:
    bargain: bool = True  # 保留讲价/逼单
    detail: bool = True  # 保留产品细节特写
    silence: bool = True  # 自动去除无声/冗长卡顿与空白空镜
    filter_live_pitch: bool = True  # 自动过滤直播导流口播（1号链接、小黄车、去拍等）
    filter_price: bool = False  # 自动过滤价格与逼单口播（不报价格/纯种草讲解）
    negative_words: tuple[str, ...] = ()  # 自定义否词列表

    @classmethod
    def from_dict(
        cls,
        raw: dict | None,
        negative_words: list[str] | None = None,
        filter_live_pitch: bool | None = None,
        filter_price: bool | None = None,
    ) -> ExtractRules:
        if not raw:
            raw = {}
        negs = list(negative_words if negative_words is not None else raw.get("negative_words", []))
        flp = filter_live_pitch if filter_live_pitch is not None else raw.get("filter_live_pitch", True)
        fp = filter_price if filter_price is not None else raw.get("filter_price", False)
        return cls(
            bargain=bool(raw.get("bargain", True)),
            detail=bool(raw.get("detail", True)),
            silence=bool(raw.get("silence", True)),
            filter_live_pitch=bool(flp),
            filter_price=bool(fp),
            negative_words=tuple(str(w).strip() for w in negs if str(w).strip()),
        )


@dataclass
class NarrativeBlock:
    """连贯语义话术段落：由原片中同一时间段内连续表达的多句话组成，保证语意表达完整，杜绝断句断意。"""

    path: Path
    start: float
    end: float
    text: str
    clips: list[EditClip]
    role: str  # intro | price | filler
    hook_score: float = 0.0
    detail_score: float = 0.0
    price_score: float = 0.0
    total_score: float = 0.0
    source_index: int = 0

    @property
    def duration(self) -> float:
        return max(0.2, self.end - self.start)


def block_key(block: NarrativeBlock) -> tuple[str, float, float]:
    return (str(block.path), round(block.start, 2), round(block.end, 2))


def opening_fingerprint(block: NarrativeBlock) -> str:
    """开场口播指纹：同一句「家人们今天…」出现在不同切片里也算重复。"""
    return re.sub(r"\s+", "", block.text or "")[:18]


_OPENING_LOCK = threading.Lock()
_OPENING_USED: dict[str, dict[str, set]] = {}


def claim_variant_opening(
    blocks: list[NarrativeBlock],
    *,
    variant: int,
    batch_id: str | None = None,
    randomize_intro: bool = True,
) -> NarrativeBlock | None:
    """
    为批量成片锁定一个互不重复的开场段落：
    优先换不同素材文件，再换同一文件里的不同 Hook。
    同一 batch 内已用过的开场（含相同口播指纹）会被跳过。
    """
    if not blocks:
        return None
    if not randomize_intro and variant <= 0:
        ranked = sorted(blocks, key=lambda b: b.total_score, reverse=True)
        return ranked[0] if ranked else None

    variant = max(0, int(variant))
    by_src: dict[str, list[NarrativeBlock]] = {}
    sources: list[str] = []
    for b in blocks:
        sp = str(b.path)
        if sp not in by_src:
            sources.append(sp)
            by_src[sp] = []
        by_src[sp].append(b)
    for group in by_src.values():
        group.sort(key=lambda b: b.total_score, reverse=True)

    ranked: list[NarrativeBlock] = []
    if len(sources) > 1:
        rot_s = variant % len(sources)
        src_order = sources[rot_s:] + sources[:rot_s]
        inner = variant // len(sources)
        for sp in src_order:
            group = list(by_src[sp])
            if variant > 0:
                later = [b for b in group if b.start >= 18.0]
                if later:
                    group = later + [b for b in group if b.start < 18.0]
            rot_i = inner % len(group)
            ranked.extend(group[rot_i:] + group[:rot_i])
    else:
        items = list(by_src[sources[0]]) if sources else list(blocks)
        if variant > 0:
            later = [b for b in items if b.start >= 18.0]
            if later:
                items = later + [b for b in items if b.start < 18.0]
        rot = variant % len(items)
        if randomize_intro and variant == 0 and len(items) > 1:
            rot = random.Random().randrange(len(items))
        ranked = items[rot:] + items[:rot]

    if not ranked:
        return None
    if not batch_id:
        return ranked[0]

    with _OPENING_LOCK:
        if len(_OPENING_USED) > 48:
            while len(_OPENING_USED) > 24:
                _OPENING_USED.pop(next(iter(_OPENING_USED)))
        used = _OPENING_USED.setdefault(batch_id, {"keys": set(), "fps": set()})
        for b in ranked:
            key = block_key(b)
            fp = opening_fingerprint(b)
            if key in used["keys"]:
                continue
            if fp and fp in used["fps"]:
                continue
            used["keys"].add(key)
            if fp:
                used["fps"].add(fp)
            return b
        chosen = ranked[0]
        used["keys"].add(block_key(chosen))
        fp = opening_fingerprint(chosen)
        if fp:
            used["fps"].add(fp)
        return chosen


def splice_opening(plan: list[EditClip], opening: NarrativeBlock | None) -> list[EditClip]:
    """把指定开场段落钉在成片最前面，并去掉后面重复的同一段。"""
    if not opening or not opening.clips:
        return plan
    keys = {(c.path, round(c.start, 2), round(c.end, 2)) for c in opening.clips}
    rest = [c for c in plan if (c.path, round(c.start, 2), round(c.end, 2)) not in keys]
    return list(opening.clips) + rest


def is_negative_segment(text: str, rules: ExtractRules) -> bool:
    """检查当前口播切片是否命中了自定义否词、直播导流黑名单或价格过滤。"""
    if not text:
        return False
    # 1. 用户自定义否词检查
    for kw in rules.negative_words:
        if kw and kw in text:
            return True
    # 2. 直播间导流与废话口播过滤
    if rules.filter_live_pitch:
        for pitch in DEFAULT_LIVE_PITCH_WORDS:
            if pitch in text:
                return True
    # 3. 价格与逼单口播过滤（不报价格 / 纯种草模式）
    if rules.filter_price:
        if PRICE_RE.search(text):
            return True
    return False


def _is_sparse_or_stalled(seg: TranscriptSegment) -> bool:
    """Heuristic: long window with little speech ≈ 卡顿/无声口播。"""
    text = seg.text.strip()
    dur = max(0.1, seg.end - seg.start)
    if dur >= 3.0 and len(text) <= 4:
        return True
    # Chinese roughly >= 2 chars/sec when speaking; far below = stall/silence
    if dur >= 2.0 and (len(text) / dur) < 1.1:
        return True
    # 极短且几乎没有字才当卡顿丢掉；0.35s 以上的真实口播要保留
    if dur < 0.35:
        return True
    return False


def extract_narrative_blocks(
    clips: list[tuple[Path, list[TranscriptSegment]]],
    *,
    rules: ExtractRules,
    max_block_seconds: float = 18.0,
    min_block_seconds: float = 2.0,
) -> list[NarrativeBlock]:
    """
    将 ASR 识别出的单句按【时间连续性】与【话题完整性】聚类为高连贯的「话术叙事段落」。
    保证段落内部一气呵成，完整表达一个核心卖点/引子/价格机制，杜绝断头截尾。
    """
    blocks: list[NarrativeBlock] = []

    for src_idx, (path, segs) in enumerate(clips):
        valid_segs: list[TranscriptSegment] = []
        for s in segs:
            if not s.text.strip() or s.end <= s.start:
                continue
            if is_negative_segment(s.text, rules):
                continue
            if rules.silence and _is_sparse_or_stalled(s):
                continue
            valid_segs.append(s)

        if not valid_segs:
            continue

        curr_segs: list[TranscriptSegment] = []

        def flush_block() -> None:
            nonlocal curr_segs
            if not curr_segs:
                return
            b_start = curr_segs[0].start
            b_end = curr_segs[-1].end
            b_text = "".join(s.text.strip() for s in curr_segs)
            dur = max(0.2, b_end - b_start)

            if dur < min_block_seconds and len(b_text) < 6:
                curr_segs = []
                return

            hook_cnt = len(INTRO_RE.findall(b_text))
            detail_cnt = len(DETAIL_RE.findall(b_text))
            price_cnt = len(PRICE_RE.findall(b_text))

            # 确定段落的核心带货角色
            role = "filler"
            if price_cnt > 0 and rules.bargain:
                role = "price"
            elif hook_cnt > 0:
                role = "intro"
            elif detail_cnt > 0:
                role = "intro" if rules.detail else "filler"

            # 综合评分：优先选语速均匀、句意丰富、表达饱满（5~15s）的黄金段落
            score = 0.0
            if role == "price":
                score += 5.0 + price_cnt * 1.5
            elif role == "intro":
                score += 4.0 + hook_cnt * 1.2 + (detail_cnt * 0.8 if rules.detail else 0)
            else:
                score += 1.0 + detail_cnt * 0.5

            if 4.0 <= dur <= 14.0:
                score += 2.0
            elif dur < 2.5:
                score -= 1.0

            # 句数饱满加分（2~5句连贯叙事最佳）
            if 2 <= len(curr_segs) <= 5:
                score += 1.5

            # 构造 EditClip 列表（段落内所有单句完全连续）
            block_clips = [
                EditClip(
                    path=path,
                    start=s.start,
                    end=s.end,
                    text=s.text.strip(),
                    role=role,
                )
                for s in curr_segs
            ]

            blocks.append(
                NarrativeBlock(
                    path=path,
                    start=b_start,
                    end=b_end,
                    text=b_text,
                    clips=block_clips,
                    role=role,
                    hook_score=float(hook_cnt),
                    detail_score=float(detail_cnt),
                    price_score=float(price_cnt),
                    total_score=score,
                    source_index=src_idx,
                )
            )
            curr_segs = []

        for seg in valid_segs:
            if not curr_segs:
                curr_segs.append(seg)
                continue

            last_seg = curr_segs[-1]
            gap = seg.start - last_seg.end
            acc_dur = seg.end - curr_segs[0].start

            # 判定是否需要分段：
            # 1. 停顿超过 0.45 秒（说话者中断、展示空镜或换镜头）
            # 2. 段落时长已达上限（通常 15~18s 足够讲完一个完整要点）
            # 3. 当前已积攒足够时长(>=7s)且当前句明确进入价格/逼单环节，而前文是介绍环节
            is_role_shift = False
            if acc_dur >= 7.0:
                prev_text = "".join(s.text for s in curr_segs)
                if not PRICE_RE.search(prev_text) and PRICE_RE.search(seg.text):
                    is_role_shift = True

            if gap > 0.45 or acc_dur >= max_block_seconds or is_role_shift:
                flush_block()
                curr_segs.append(seg)
            else:
                curr_segs.append(seg)

        flush_block()

    return blocks


def build_sell_plan(
    clips: list[tuple[Path, list[TranscriptSegment]]],
    *,
    target_seconds: float = 60.0,
    rules: ExtractRules | None = None,
    variant: int = 0,
    randomize_intro: bool = True,
    batch_id: str | None = None,
    forced_opening: NarrativeBlock | None = None,
) -> list[EditClip]:
    """
    智能构建高连贯性带货成片：
    1. 先将转写提取为内部连续、语义完整的【话术叙事段落 (NarrativeBlock)】
    2. 按爆款结构编排：开场抓人段落 ➔ 核心卖点与细节段落 ➔ 破价福利/逼单段落
    3. 每个选中的段落内部 100% 完整连续，彻底解决「话说到一半就断了」的问题
    4. variant 与 randomize_intro 支持批量差异化轮换开场与卖点组合
    """
    rules = rules or ExtractRules()
    variant = max(0, int(variant))

    # 1. 提取所有语义连贯段落
    all_blocks = extract_narrative_blocks(clips, rules=rules)

    if not all_blocks:
        # 极少数极端兜底：单句保底
        fallback_clips: list[EditClip] = []
        for path, segs in clips:
            for s in segs:
                if s.text.strip() and not is_negative_segment(s.text, rules):
                    fallback_clips.append(
                        EditClip(path, s.start, s.end, s.text.strip(), "intro")
                    )
        return fallback_clips

    # 2. 分类候选段落池
    hook_blocks = [b for b in all_blocks if b.role == "intro"]
    price_blocks = [b for b in all_blocks if b.role == "price"]
    feature_blocks = [
        b for b in all_blocks if b.role == "filler" and b.detail_score > 0
    ]
    other_blocks = [
        b for b in all_blocks if b.role == "filler" and b.detail_score == 0
    ]

    # 按综合得分排序
    hook_blocks.sort(key=lambda b: (b.total_score, b.hook_score), reverse=True)
    price_blocks.sort(key=lambda b: (b.total_score, b.price_score), reverse=True)
    feature_blocks.sort(key=lambda b: b.total_score, reverse=True)
    other_blocks.sort(key=lambda b: b.total_score, reverse=True)

    opening_pool = hook_blocks or all_blocks
    opening = forced_opening or claim_variant_opening(
        opening_pool,
        variant=variant,
        batch_id=batch_id,
        randomize_intro=randomize_intro,
    )
    opening_k = block_key(opening) if opening else None

    if price_blocks and variant > 0:
        rot_p = (variant * 3) % len(price_blocks)
        price_blocks = price_blocks[rot_p:] + price_blocks[:rot_p]

    if feature_blocks and variant > 0:
        rng = random.Random(variant * 1013 + 37)
        rng.shuffle(feature_blocks)

    selected_blocks: list[NarrativeBlock] = []
    used_block_keys: set[tuple[str, float, float]] = set()
    total_time = 0.0

    def try_add_block(b: NarrativeBlock) -> bool:
        nonlocal total_time
        key = block_key(b)
        if key in used_block_keys:
            return False
        dur = b.duration
        # 允许时长在目标时长的 0.8x ~ 1.15x 之间
        if total_time + dur > target_seconds * 1.15 and total_time >= target_seconds * 0.75:
            return False
        selected_blocks.append(b)
        used_block_keys.add(key)
        total_time += dur
        return True

    # 动态规划结构预算：
    if rules.filter_price:
        # 不报价格/纯种草模式：100% 预算分配给痛点开场与核心卖点/细节讲解，价格预算为 0
        hook_budget = target_seconds * (0.35 + ((variant % 3) - 1) * 0.05)
        price_budget = 0.0
    else:
        # 标准带货模式：开场 Hook 占 25%~35%，卖点/细节占 35%~50%，价格/福利占 25%~35%
        hook_budget = target_seconds * (0.28 + ((variant % 3) - 1) * 0.04)
        price_budget = target_seconds * (0.30 + ((variant % 2) * 0.05))

    # Step 1: 先钉死差异化开场，再补其它 intro（不再按原片时间把开场冲回第一句）
    if opening:
        try_add_block(opening)

    for b in hook_blocks:
        if total_time >= hook_budget:
            break
        if opening_k is not None and block_key(b) == opening_k:
            continue
        try_add_block(b)

    # 如果没有专属 hook，取一个有声音的段落作为开场
    if not selected_blocks and all_blocks:
        try_add_block(opening or all_blocks[0])

    # Step 2: 选取核心卖点/产品细节段落 (Features & Details)
    detail_candidates = feature_blocks + [
        b for b in hook_blocks if opening_k is None or block_key(b) != opening_k
    ]
    for b in detail_candidates:
        if total_time >= target_seconds - price_budget:
            break
        try_add_block(b)

    # Step 3: 选取价格/逼单/福利段落 (Price / Bargain / Call-To-Action)
    if rules.bargain and not rules.filter_price and price_blocks:
        for b in price_blocks:
            if total_time >= target_seconds * 0.95:
                break
            try_add_block(b)

    # Step 4: 若时长仍不足，补充其他连贯段落
    if total_time < target_seconds * 0.75:
        remaining_pool = [b for b in all_blocks if block_key(b) not in used_block_keys]
        for b in remaining_pool:
            if total_time >= target_seconds:
                break
            try_add_block(b)

    # 3. 开场段落固定第一，其余按带货逻辑编排：
    # [差异化开场] ➔ [其它种草] ➔ [细节] ➔ [价格/逼单]
    opening_selected = None
    if opening_k is not None:
        for b in selected_blocks:
            if block_key(b) == opening_k:
                opening_selected = b
                break

    intros = [
        b
        for b in selected_blocks
        if b.role == "intro" and (opening_k is None or block_key(b) != opening_k)
    ]
    prices = [b for b in selected_blocks if b.role == "price"]
    others = [b for b in selected_blocks if b.role == "filler"]

    intros.sort(key=lambda b: (b.path.name, b.start))
    prices.sort(key=lambda b: (b.path.name, b.start))
    others.sort(key=lambda b: (b.path.name, b.start))

    ordered_blocks: list[NarrativeBlock] = []
    if opening_selected:
        ordered_blocks.append(opening_selected)
    ordered_blocks.extend(intros + others + prices)

    # 4. 展平为连续的 EditClip 列表，段落内部单句完全完整
    result_clips: list[EditClip] = []
    for b in ordered_blocks:
        result_clips.extend(b.clips)

    return result_clips


def build_magic_cues(clips: list[EditClip], *, variant: int = 0) -> list[MagicCue]:
    """根据成片段落与关键词位置，智能生成成片「神奇大字」屏幕提示。"""
    tips_price = [
        "破价！",
        "今天特价",
        "手慢无",
        "马上拍",
        "限时秒杀",
        "立省两百",
        "福利价",
        "最后一波",
        "闭眼冲",
    ]
    tips_intro = [
        "必入！",
        "主推爆款",
        "绝绝子",
        "闭眼入",
        "真的好看",
        "质感拉满",
        "细节满分",
        "高级感",
        "看这里",
    ]
    offset = variant % len(tips_price)
    tips = tips_price[offset:] + tips_price[:offset]
    intro_offset = variant % len(tips_intro)
    intro_tips = tips_intro[intro_offset:] + tips_intro[:intro_offset]

    cues: list[MagicCue] = []
    t = 0.0
    tip_i = 0
    intro_i = 0

    for clip in clips:
        dur = max(0.2, clip.end - clip.start)
        if clip.role == "price" or PRICE_RE.search(clip.text):
            if tip_i < 2:
                cues.append(
                    MagicCue(text=tips[tip_i % len(tips)], at=t + 0.15, duration=1.8)
                )
                tip_i += 1
        elif (clip.role == "intro" or INTRO_RE.search(clip.text)) and intro_i < 2:
            cues.append(
                MagicCue(
                    text=intro_tips[intro_i % len(intro_tips)],
                    at=max(0.2, t + 0.2),
                    duration=1.6,
                )
            )
            intro_i += 1
        t += dur
        if len(cues) >= 4:
            break

    if not cues and clips:
        cues.append(MagicCue(text="主推爆款", at=0.3, duration=2.0))

    return cues[:4]
