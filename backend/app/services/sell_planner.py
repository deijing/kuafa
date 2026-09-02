from __future__ import annotations

import random
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from app.services.transcription import _DANGLING_CONNECTIVES, TranscriptSegment

PRICE_RE = re.compile(
    r"(元|块钱|块|米|价格|只要|到手|特价|秒杀|清仓|包邮|券后|拍下|优惠|打折|便宜|福利|逼单|现货|秒发|库存|马上|下单|带走|拍一发|立省|省下|手慢无|闭眼冲)"
)
INTRO_RE = re.compile(
    r"(这款|今天|给你们|给大家|推荐|一眼|爆款|新款|王炸|宝藏|闭眼入|高级感|天花板|绝了|显白|显瘦|百搭|设计感|主推|看过来|第一款|首发|太好看|太绝了|姐妹们|一定要看|重磅|好物|测评|安利)"
)
DETAIL_RE = re.compile(
    r"(面料|纯棉|蚕丝|重磅|羊绒|真丝|天丝|亚麻|莫代尔|手感|软糯|亲肤|透气|不起球|不掉色|不褪色|垂感|抗皱|免烫|挺括|版型|立挺|正肩|落肩|收腰|遮肉|显瘦|显高|显腿长|包容性|走线|刺绣|双压线|包边|领口|袖口|下摆|纽扣|拉链|口袋|印花|水洗|做工|细节|特写|上身|穿搭|搭配|质感|不挑人|微弹|高弹|显档次|剪裁)"
)
SLUGGISH_CHITCHAT_RE = re.compile(
    r"(先别急|等一下|听我说啊|我跟你们说|看评论区|刚才有人问|有人说|这个怎么讲|这个啊|怎么说呢|哎呀|是不是|对不对|好不好|行不行|你们觉得呢|稍等|等会儿|聊天|聊聊)"
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
    if dur >= 3.5 and len(text) <= 3:
        return True
    if dur >= 2.5 and (len(text) / dur) < 0.8 and len(text) <= 3:
        return True
    # 极短且几乎没有字才当卡顿丢掉；0.25s 以上的真实口播要保留
    if dur < 0.25:
        return True
    return False


def text_similarity(t1: str, t2: str) -> float:
    """计算两段中文口播文本的字符级覆盖重合度（去标点与空格）。"""
    clean1 = set(re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]", t1))
    clean2 = set(re.findall(r"[\u4e00-\u9fa5a-zA-Z0-9]", t2))
    if not clean1 or not clean2:
        return 0.0
    intersection = clean1.intersection(clean2)
    smaller = min(len(clean1), len(clean2))
    return len(intersection) / smaller if smaller > 0 else 0.0


def has_long_common_substring(t1: str, t2: str, min_len: int = 6) -> bool:
    """检查两段文本是否包含 >= min_len 个连续字符的重复短语（如 '去店部里面要看好'）。"""
    c1 = re.sub(r"[^\u4e00-\u9fa5a-zA-Z0-9]", "", t1)
    c2 = re.sub(r"[^\u4e00-\u9fa5a-zA-Z0-9]", "", t2)
    if len(c1) < min_len or len(c2) < min_len:
        return False
    for i in range(len(c1) - min_len + 1):
        sub = c1[i : i + min_len]
        if sub in c2:
            return True
    return False


def is_repetitive_sentence(t1: str, t2: str) -> bool:
    """判断 t2 是否是 t1 的重复/复读机/换汤不换药的口播表达。"""
    s1, s2 = t1.strip(), t2.strip()
    if not s1 or not s2:
        return False
    if s1 == s2:
        return True
    if text_similarity(s1, s2) >= 0.58:
        return True
    if has_long_common_substring(s1, s2, min_len=6):
        return True
    return False


def deduplicate_consecutive_clips(clips: list[EditClip]) -> list[EditClip]:
    """
    智能过滤成片中相邻或近邻的重复口播、复读机车轱辘话和无意义孤立短词（如'好吧'）。
    """
    if not clips:
        return []
    result: list[EditClip] = []
    seen_texts: list[str] = []

    for clip in clips:
        text = clip.text.strip()
        dur = max(0.1, clip.end - clip.start)

        # 过滤孤立且过短的纯语气词碎片（如 '好吧'、'嗯'、'哈'、'行吧'）
        if len(text) <= 2 and dur < 0.6 and text in ("好吧", "行吧", "对吧", "嗯", "哈", "啊", "呢", "行", "对"):
            continue

        if not text:
            result.append(clip)
            continue

        # 检查是否与前 3 句已入选的内容高度重复（消除复读机）
        is_dup = False
        for prev in seen_texts[-3:]:
            if is_repetitive_sentence(prev, text):
                is_dup = True
                break

        if not is_dup:
            result.append(clip)
            seen_texts.append(text)

    return result


def extract_narrative_blocks(
    clips: list[tuple[Path, list[TranscriptSegment]]],
    *,
    rules: ExtractRules,
    max_block_seconds: float = 18.0,
    min_block_seconds: float = 1.5,
) -> list[NarrativeBlock]:
    """
    将 ASR 识别出的单句按【时间连续性】与【话题完整性】聚类为高连贯的「话术叙事段落」。
    保证段落内部一气呵成，完整表达一个核心卖点/引子/价格机制，杜绝断头截尾或把同一句话切两半。
    同时自动识别主播口癖与连续复读机，强制分流拆段，杜绝段落内重复。
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

            # 构造 EditClip 列表，并在此处执行段内去重（过滤紧随的复读句与孤立的语气词'好吧'）
            cleaned_clips: list[EditClip] = []
            seen_in_block: list[str] = []
            for s in curr_segs:
                stext = s.text.strip()
                sdur = max(0.1, s.end - s.start)
                if len(stext) <= 2 and sdur < 0.6 and stext in ("好吧", "行吧", "对吧", "嗯", "哈", "啊", "呢", "行", "对"):
                    continue
                if seen_in_block and any(is_repetitive_sentence(prev, stext) for prev in seen_in_block):
                    continue
                cleaned_clips.append(
                    EditClip(
                        path=path,
                        start=s.start,
                        end=s.end,
                        text=stext,
                        role="filler",
                    )
                )
                seen_in_block.append(stext)

            if not cleaned_clips:
                curr_segs = []
                return

            b_start = cleaned_clips[0].start
            b_end = cleaned_clips[-1].end
            b_text = "".join(c.text.strip() for c in cleaned_clips)
            dur = max(0.2, b_end - b_start)

            if dur < 1.0 and len(b_text) < 3:
                curr_segs = []
                return

            hook_cnt = len(INTRO_RE.findall(b_text))
            detail_cnt = len(DETAIL_RE.findall(b_text))
            price_cnt = len(PRICE_RE.findall(b_text))
            sluggish_cnt = len(SLUGGISH_CHITCHAT_RE.findall(b_text))

            # 确定段落的核心带货角色
            role = "filler"
            if price_cnt > 0 and rules.bargain and not rules.filter_price:
                role = "price"
            elif hook_cnt > 0:
                role = "intro"
            elif detail_cnt > 0 and rules.detail:
                role = "intro"
            elif detail_cnt > 0:
                role = "filler"

            for c in cleaned_clips:
                c.role = role

            # 纯正讲品密度（有效卖点词数 / 时长）
            pitch_density = (detail_cnt * 3.0 + hook_cnt * 2.5 + price_cnt * 2.2) / max(1.0, dur)
            score = pitch_density * 5.0

            if role == "price":
                score += 5.0 + price_cnt * 1.5
            elif role == "intro":
                score += 4.5 + hook_cnt * 1.5 + (detail_cnt * 1.2 if rules.detail else 0)
            else:
                score += (detail_cnt * 1.2) if rules.detail else 0.5

            # 黄金快节奏时长奖励（3.5s ~ 9.0s 紧凑高能输出）
            if 3.5 <= dur <= 9.0:
                score += 3.5
            elif dur > 13.0:
                score -= 2.5

            # 严厉惩罚拖沓、闲聊与无意义废话
            if sluggish_cnt > 0:
                score -= sluggish_cnt * 4.0

            # 若完全无任何讲品关键词（纯口水话），大幅降分防止拖沓
            if hook_cnt == 0 and detail_cnt == 0 and price_cnt == 0:
                score -= 9.0

            blocks.append(
                NarrativeBlock(
                    path=path,
                    start=b_start,
                    end=b_end,
                    text=b_text,
                    clips=cleaned_clips,
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
            prev_text = "".join(s.text for s in curr_segs)

            # 判定是否需要分段：
            # 1. 停顿超过 1.10 秒（明显转场或较长静音中断）
            # 2. 段落时长达到上限且前句已完整收尾（非悬空连接词）
            # 3. 当前已积攒足够时长(>=7s)且当前句明确进入价格/逼单环节，而前文是介绍环节
            # 4. 重复句检测：若当前句与当前段落内已有句子高度重复（主播复读机），强制切段分流
            is_role_shift = False
            if acc_dur >= 7.0:
                if not PRICE_RE.search(prev_text) and PRICE_RE.search(seg.text):
                    is_role_shift = True

            is_repeating = any(is_repetitive_sentence(s.text, seg.text) for s in curr_segs)
            is_dangling = bool(_DANGLING_CONNECTIVES.search(prev_text))
            
            should_flush = False
            if is_repeating:
                should_flush = True
            elif gap > 1.10 and not is_dangling:
                should_flush = True
            elif acc_dur >= max_block_seconds and not is_dangling:
                should_flush = True
            elif is_role_shift and not is_dangling:
                should_flush = True

            if should_flush:
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

    # 4. 展平为连续的 EditClip 列表，并执行连续复读机去重
    result_clips: list[EditClip] = []
    for b in ordered_blocks:
        result_clips.extend(b.clips)

    return deduplicate_consecutive_clips(result_clips)


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


def build_material_coverage_plan(
    clips: list[tuple[Path, list[TranscriptSegment]]],
    *,
    target_seconds: float = 60.0,
    rules: ExtractRules | None = None,
    variant: int = 0,
    randomize_intro: bool = True,
    batch_id: str | None = None,
) -> list[EditClip]:
    """
    按素材分切 & 全素材覆盖拼接（保证用户选中的每个素材 100% 出现）：
    - 针对用户选中的 N 个素材，将总时长均分给这 N 个素材。
    - 对每个素材独立提取语义完整的话术段落（NarrativeBlock），挑选该素材的最优黄金片段。
    - 第 1 个素材优先提取开场 Hook/痛点引子；中间素材提取核心卖点/产品特写细节；最后一个素材若有价格福利则提取逼单段落。
    - 彻底解决只拼接前两个素材、漏掉后面素材的问题！
    """
    rules = rules or ExtractRules()
    if not clips:
        return []

    num_materials = len(clips)
    if num_materials == 1:
        return build_sell_plan(
            clips,
            target_seconds=target_seconds,
            rules=rules,
            variant=variant,
            randomize_intro=randomize_intro,
            batch_id=batch_id,
        )

    budget_per_mat = max(3.0, target_seconds / num_materials)
    selected_blocks_per_material: list[list[NarrativeBlock]] = []

    for mat_idx, (path, segs) in enumerate(clips):
        # 1. 提取当前素材的所有连贯段落
        mat_blocks = extract_narrative_blocks([(path, segs)], rules=rules)

        if not mat_blocks:
            # 兜底：如果过滤后无段落，从原有效单句保底
            valid_segs = [
                s for s in segs
                if s.text.strip() and not is_negative_segment(s.text, rules)
            ]
            if valid_segs:
                curr_dur = 0.0
                picked_segs = []
                for s in valid_segs:
                    s_dur = max(0.2, s.end - s.start)
                    picked_segs.append(s)
                    curr_dur += s_dur
                    if curr_dur >= budget_per_mat:
                        break
                mat_blocks = [
                    NarrativeBlock(
                        path=path,
                        start=picked_segs[0].start,
                        end=picked_segs[-1].end,
                        text="".join(s.text.strip() for s in picked_segs),
                        clips=[
                            EditClip(path, s.start, s.end, s.text.strip(), "intro")
                            for s in picked_segs
                        ],
                        role="intro",
                        total_score=1.0,
                        source_index=mat_idx,
                    )
                ]
            else:
                # 若完全无有效转写，从原视频按时长安全抽样
                from app.services.ffmpeg_pipeline import probe_cached
                try:
                    p_info = probe_cached(path)
                    v_dur = p_info.duration
                except Exception:
                    v_dur = 5.0
                clip_dur = min(budget_per_mat, max(1.0, v_dur))
                mat_blocks = [
                    NarrativeBlock(
                        path=path,
                        start=0.0,
                        end=clip_dur,
                        text="",
                        clips=[EditClip(path, 0.0, clip_dur, "", "filler")],
                        role="filler",
                        total_score=0.5,
                        source_index=mat_idx,
                    )
                ]

        # 2. 根据当前素材在整体拼接中的角色选出最佳段落
        is_first = (mat_idx == 0)
        is_last = (mat_idx == num_materials - 1)

        hooks = [b for b in mat_blocks if b.role == "intro"]
        prices = [b for b in mat_blocks if b.role == "price"]
        details = [b for b in mat_blocks if b.role == "filler" and b.detail_score > 0]
        others = [b for b in mat_blocks if b.role == "filler" and b.detail_score == 0]

        hooks.sort(key=lambda b: (b.total_score, b.hook_score), reverse=True)
        prices.sort(key=lambda b: (b.total_score, b.price_score), reverse=True)
        details.sort(key=lambda b: b.total_score, reverse=True)
        others.sort(key=lambda b: b.total_score, reverse=True)

        candidate_list: list[NarrativeBlock] = []
        if is_first:
            # 开场素材：优先 Hook
            candidate_list = hooks + details + others + prices
        elif is_last and rules.bargain and not rules.filter_price:
            # 结尾素材：优先 Price/逼单
            candidate_list = prices + details + hooks + others
        else:
            # 中间素材：优先产品细节与卖点
            candidate_list = details + hooks + others + prices

        if not candidate_list:
            candidate_list = mat_blocks

        # 差异化轮换选择
        if variant > 0 and len(candidate_list) > 1:
            rot = (variant + mat_idx) % len(candidate_list)
            candidate_list = candidate_list[rot:] + candidate_list[:rot]

        # 挑选契合 budget_per_mat 的【单一连续纯正讲品黄金段落】（确保每个素材严格只出场 1 次、1 段连续镜头，杜绝拖沓与闲聊）
        valid_candidates = [
            b for b in candidate_list
            if b.total_score > 0 and (b.hook_score > 0 or b.detail_score > 0 or b.price_score > 0)
        ] or candidate_list

        best_block = valid_candidates[0]
        for b in valid_candidates:
            b_score = b.total_score - abs(b.duration - budget_per_mat) * 0.35
            best_score = best_block.total_score - abs(best_block.duration - budget_per_mat) * 0.35
            if b_score > best_score:
                best_block = b

        selected_blocks_per_material.append([best_block])

    # 3. 将各素材的选定段落按素材顺序拼接，并执行全局复读机去重
    final_clips: list[EditClip] = []
    for mat_blocks_picked in selected_blocks_per_material:
        for b in mat_blocks_picked:
            final_clips.extend(b.clips)

    return deduplicate_consecutive_clips(final_clips)
