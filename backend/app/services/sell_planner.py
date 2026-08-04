from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.services.transcription import TranscriptSegment

PRICE_RE = re.compile(
    r"(元|块钱|块|价格|只要|特价|秒杀|清仓|包邮|到手|券后|拍下|链接|优惠|打折|便宜|福利|逼单|库存|马上)"
)
INTRO_RE = re.compile(
    r"(这款|今天|给大家|介绍|看看|面料|上身|版型|颜色|新款|搭配|质感|细节|推荐|特写|展示)"
)
DETAIL_RE = re.compile(r"(面料|上身|版型|颜色|质感|细节|特写|展示|搭配|摸起来|手感)")


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
    silence: bool = False  # 去除无声/冗长卡顿

    @classmethod
    def from_dict(cls, raw: dict[str, bool] | None) -> ExtractRules:
        if not raw:
            return cls()
        return cls(
            bargain=bool(raw.get("bargain", True)),
            detail=bool(raw.get("detail", True)),
            silence=bool(raw.get("silence", False)),
        )


def _score(seg: TranscriptSegment, role: str) -> float:
    text = seg.text
    dur = max(0.1, seg.end - seg.start)
    score = 0.0
    if role == "price" and PRICE_RE.search(text):
        score += 5.0
    if role == "intro" and INTRO_RE.search(text):
        score += 3.0
        if DETAIL_RE.search(text):
            score += 1.5
    if role == "filler":
        score += 1.0
    # prefer readable length 1.5–6s
    if 1.5 <= dur <= 6.0:
        score += 1.5
    elif dur < 1.0:
        score -= 1.0
    return score


def _is_sparse_or_stalled(seg: TranscriptSegment) -> bool:
    """Heuristic: long window with little speech ≈ 卡顿/无声口播。"""
    text = seg.text.strip()
    dur = max(0.1, seg.end - seg.start)
    if dur >= 3.5 and len(text) <= 4:
        return True
    # Chinese roughly ≥2 chars/sec when speaking; far below = stall
    if dur >= 2.5 and (len(text) / dur) < 1.2:
        return True
    if dur < 0.7:
        return True
    return False


def build_sell_plan(
    clips: list[tuple[Path, list[TranscriptSegment]]],
    *,
    target_seconds: float = 60.0,
    rules: ExtractRules | None = None,
    variant: int = 0,
) -> list[EditClip]:
    """
    Build a Douyin selling cut:
    front = product intro, middle/end = price/promo, fillers fill remaining time.
    Cuts are always whole ASR sentences (no mid-character trim).

    variant>0: diversify cut for batch production (rotate material preference,
    skip top-scoring clips, shift intro/price budget) so multiple jobs from the
    same folder don't produce identical edits.
    """
    rules = rules or ExtractRules()
    variant = max(0, int(variant))

    all_items: list[EditClip] = []
    for path, segs in clips:
        for seg in segs:
            if not seg.text.strip() or seg.end <= seg.start:
                continue
            if rules.silence and _is_sparse_or_stalled(seg):
                continue
            start = seg.start
            end = seg.end
            role = "filler"
            if PRICE_RE.search(seg.text):
                role = "price" if rules.bargain else "filler"
            elif INTRO_RE.search(seg.text):
                role = "intro"
            # 关闭细节特写时：细节向 intro 降为 filler
            if role == "intro" and not rules.detail and DETAIL_RE.search(seg.text):
                role = "filler"
            all_items.append(
                EditClip(
                    path=path, start=start, end=end, text=seg.text.strip(), role=role
                )
            )

    if not all_items:
        return []

    # Prefer different source files per variant (round-robin by path name).
    paths = sorted({str(c.path) for c in all_items})
    prefer_path = paths[variant % len(paths)] if paths else ""

    def _path_boost(clip: EditClip) -> float:
        return 2.0 if str(clip.path) == prefer_path else 0.0

    intros = sorted(
        [c for c in all_items if c.role == "intro"],
        key=lambda c: _score(TranscriptSegment(c.start, c.end, c.text), "intro")
        + _path_boost(c),
        reverse=True,
    )
    prices = sorted(
        [c for c in all_items if c.role == "price"],
        key=lambda c: _score(TranscriptSegment(c.start, c.end, c.text), "price")
        + _path_boost(c),
        reverse=True,
    )
    fillers = sorted(
        [c for c in all_items if c.role == "filler"],
        key=lambda c: (c.path.name, c.start),
    )

    # Rotate ranked lists so variant N skips the top picks of earlier variants.
    if variant and intros:
        rot = variant % len(intros)
        intros = intros[rot:] + intros[:rot]
    if variant and prices:
        rot = variant % len(prices)
        prices = prices[rot:] + prices[:rot]
    if variant and fillers:
        rot = (variant * 3) % len(fillers)
        fillers = fillers[rot:] + fillers[:rot]

    chronological = sorted(all_items, key=lambda c: (c.path.name, c.start))
    if variant and chronological:
        rot = (variant * 5) % len(chronological)
        chronological = chronological[rot:] + chronological[:rot]

    selected: list[EditClip] = []
    used: set[tuple[str, float, float]] = set()
    total = 0.0

    def try_add(clip: EditClip) -> bool:
        nonlocal total
        key = (str(clip.path), round(clip.start, 2), round(clip.end, 2))
        if key in used:
            return False
        dur = clip.end - clip.start
        if total + dur > target_seconds * 1.15 and total >= target_seconds * 0.75:
            return False
        selected.append(clip)
        used.add(key)
        total += dur
        return True

    # Variant shifts structure: 0=intro-heavy, 1=balanced, 2+=price-forward.
    intro_ratio = 0.35 if variant == 0 else (0.28 if variant == 1 else 0.22)
    price_ratio = 0.30 if variant == 0 else (0.35 if variant == 1 else 0.42)

    # 1) intro block
    intro_budget = target_seconds * intro_ratio
    for clip in intros:
        if total >= intro_budget:
            break
        try_add(clip)
    if total < intro_budget * 0.5:
        for clip in chronological:
            if total >= intro_budget:
                break
            try_add(clip)

    # 2) price block — only when bargain kept
    if rules.bargain and prices:
        price_start_total = total
        for clip in prices:
            if total - price_start_total >= target_seconds * price_ratio:
                break
            try_add(clip)
        if not any(c.role == "price" for c in selected):
            mid = chronological[
                len(chronological) // 3 : 2 * len(chronological) // 3
            ]
            for clip in mid:
                if total >= target_seconds * 0.7:
                    break
                c = EditClip(clip.path, clip.start, clip.end, clip.text, "price")
                try_add(c)

    # 3) fillers to target
    for clip in fillers + chronological:
        if total >= target_seconds:
            break
        try_add(clip)

    if not selected:
        for path, segs in clips:
            for s in segs:
                if rules.silence and _is_sparse_or_stalled(s):
                    continue
                if s.text.strip():
                    selected.append(
                        EditClip(path, s.start, s.end, s.text.strip(), "intro")
                    )
                    break

    intros_sel = [c for c in selected if c.role == "intro"]
    prices_sel = [c for c in selected if c.role == "price"]
    others = [c for c in selected if c.role == "filler"]
    intros_sel.sort(key=lambda c: (c.path.name, c.start))
    prices_sel.sort(key=lambda c: (c.path.name, c.start))
    others.sort(key=lambda c: (c.path.name, c.start))

    ordered = intros_sel + prices_sel + others
    # Variant 2+: lightly interleave fillers earlier for different pacing.
    if variant >= 2 and others and intros_sel:
        half = max(1, len(others) // 2)
        ordered = intros_sel + others[:half] + prices_sel + others[half:]
    return ordered


def build_magic_cues(clips: list[EditClip], *, variant: int = 0) -> list[MagicCue]:
    """规则兜底：在价格/逼单句附近弹出短大字提示。"""
    tips_price = ["破价！", "今天特价", "手慢无", "马上拍"]
    tips_intro = ["必入！", "绝绝子", "闭眼入"]
    tips = tips_price[variant % len(tips_price) :] + tips_price
    intro_tips = tips_intro[variant % len(tips_intro) :] + tips_intro

    cues: list[MagicCue] = []
    t = 0.0
    tip_i = 0
    intro_i = 0
    for clip in clips:
        dur = max(0.2, clip.end - clip.start)
        if clip.role == "price" or PRICE_RE.search(clip.text):
            cues.append(
                MagicCue(text=tips[tip_i % len(tips)], at=t + 0.15, duration=1.8)
            )
            tip_i += 1
        elif clip.role == "intro" and intro_i < 1:
            cues.append(
                MagicCue(
                    text=intro_tips[intro_i % len(intro_tips)],
                    at=t + 0.2,
                    duration=1.6,
                )
            )
            intro_i += 1
        t += dur
        if len(cues) >= 4:
            break

    if not cues and clips:
        cues.append(MagicCue(text="限时特惠", at=0.4, duration=2.0))
    return cues[:4]
