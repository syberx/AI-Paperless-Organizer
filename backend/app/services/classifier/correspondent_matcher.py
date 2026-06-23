"""Conservative correspondent name matching for the classifier (opt-in Beta feature).

Pure, side-effect-free module (stdlib + the leaf normalize module only). Given an
LLM-proposed correspondent name and the list of existing correspondent display
names, it decides whether the proposal should REUSE an existing correspondent
instead of creating a near-duplicate.

Two tiers:
  - Tier A (normalized-equal): deterministic case/diacritic/punctuation normalization;
    a hit means the normalized keys are byte-identical (no SequenceMatcher involved).
    With strip_legal=True (default) legal-form suffixes (GmbH/AG/e.V./...) are also
    dropped, so same-brand entities differing only in legal form are deliberately treated
    as one. A degenerate key (empty or a single <2-char token after stripping, e.g.
    "A GmbH") falls back to the un-stripped form so "A GmbH" and "A AG" are NOT collapsed.
  - Tier B (guarded fuzzy, opt-in via allow_fuzzy): catches real typo/OCR variants,
    but only under several conservative guards so that two genuinely different firms
    or surnames (e.g. "Schmidt" vs "Schmitt") are NOT merged — when in doubt, CREATE.

The caller always falls back to the unchanged get_or_create_correspondent() when
this returns None, so "no confident match" simply means "behave as before".
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional

from app.services.classifier.correspondent_normalize import _strip_legal_forms

# Per-token similarity floor for the Tier-B alignment guard. FIXED safety floor,
# deliberately NOT user-configurable (raising the global threshold does not protect
# against surname traps like Schmidt/Schmitt=0.93 — the per-token guard does).
_TOKEN_FLOOR = 0.90

_UMLAUT_MAP = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}
# hyphen, NBSP-hyphen, figure dash, en dash, em dash, minus sign
_HYPHENS = ("-", "‐", "‑", "‒", "–", "—", "−")
_PUNCT = ".,/\\()\"'’:;|_"

# Known OCR character confusions (digit/letter look-alikes). Used ONLY to let the
# per-token guard pass on these specific confusions; never lowers any threshold and
# is never a standalone acceptance reason.
_OCR_MAP = str.maketrans({"0": "o", "1": "l", "5": "s", "8": "b", "|": "l"})


@dataclass
class MatchResult:
    matched_name: str          # the existing correspondent DISPLAY name to reuse
    ratio: float               # full-string similarity (1.0 for normalized-equal)
    reason: str                # 'normalized_equal' | 'fuzzy_high'
    runner_up: Optional[str] = None
    runner_up_ratio: float = 0.0


def _finish_normalize(text: str) -> str:
    """Separator/punctuation unification + whitespace collapse (shared tail)."""
    for h in _HYPHENS:
        text = text.replace(h, " ")
    text = text.replace("&", " und ").replace("+", " und ")
    for p in _PUNCT:
        text = text.replace(p, " ")
    return re.sub(r"\s+", " ", text).strip()


def _normalize_corr(name: str, strip_legal: bool) -> str:
    """Deterministic comparison key. Order is locked — see module docstring.

    The returned string is used ONLY for comparison; the name written to Paperless
    is always the original proposed string or the matched correspondent's stored
    display name, never this normalized form. NOTE: no length cap here — the cap that
    bounds SequenceMatcher lives in _ratio, so the Tier-A equality key always compares
    full strings and cannot collapse two names that share a long common prefix.
    """
    if not name or not name.strip():
        return ""
    s = name.strip().casefold()
    for k, v in _UMLAUT_MAP.items():
        s = s.replace(k, v)
    # Drop stray combining marks (OCR accents like é -> e). NFKD never raises.
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    if not strip_legal:
        return _finish_normalize(s)
    # Legal-form strip BEFORE punctuation removal (so a trailing ", GmbH" is matched).
    key = _finish_normalize(_strip_legal_forms(s))
    # Guard: if stripping the legal form left a degenerate key (no token >= 2 chars,
    # e.g. "A GmbH" -> "a"), keep the un-stripped form so distinct legal forms of a
    # one-letter brand ("A GmbH" vs "A AG") are not collapsed.
    if any(len(t) >= 2 for t in key.split(" ")):
        return key
    return _finish_normalize(s)


def _ratio(a: str, b: str) -> float:
    # Cap inputs to bound SequenceMatcher's O(L^2) on OCR-garbage names. Applied ONLY
    # here (never to the Tier-A equality key), so it cannot cause a normalized-equal
    # mis-merge of two names that share a long common prefix.
    return difflib.SequenceMatcher(None, a[:128], b[:128]).ratio()


def _ocr_canon(token: str) -> str:
    return token.translate(_OCR_MAP).replace("rn", "m")


def _ocr_equiv(t1: str, t2: str) -> bool:
    """True if two tokens are equal after mapping known OCR look-alike confusions."""
    return _ocr_canon(t1) == _ocr_canon(t2)


def match_correspondent(
    proposed: str,
    existing_names: List[str],
    *,
    threshold: float = 0.90,
    strip_legal: bool = True,
    allow_fuzzy: bool = False,
) -> Optional[MatchResult]:
    """Return a MatchResult if the proposed name should reuse an existing
    correspondent, else None (caller then creates as before).

    threshold:   full-string similarity floor for Tier B (0..1).
    strip_legal: also ignore legal forms (GmbH/AG/...) when comparing.
    allow_fuzzy: enable Tier B (guarded fuzzy). When False, only the provably-safe
                 Tier A (normalized-equal) runs.
    """
    if not proposed:
        return None
    np = _normalize_corr(proposed, strip_legal)
    if not np:
        return None

    cands = []
    for dn in existing_names:
        nc = _normalize_corr(dn, strip_legal)
        if nc:
            cands.append((dn, nc))
    if not cands:
        return None

    # ── Tier A: normalized-equal (provably cannot mis-merge) ──────────────────
    by_norm = {}
    for dn, nc in cands:
        by_norm.setdefault(nc, dn)  # first display name wins on rare norm collisions
    if np in by_norm:
        return MatchResult(matched_name=by_norm[np], ratio=1.0, reason="normalized_equal")

    if not allow_fuzzy:
        return None

    # ── Tier B: guarded fuzzy ─────────────────────────────────────────────────
    if len(np) < 4:                       # GUARD 2: short strings have inflated ratios
        return None
    np_tokens = np.split(" ")
    if len(np_tokens) < 2:                # GUARD 1: single-token names get Tier A only
        return None

    max_len_diff = max(3, 0.25 * len(np))
    scored = []
    for dn, nc in cands:
        if abs(len(nc) - len(np)) > max_len_diff:   # length pre-filter (perf + sanity)
            continue
        scored.append((_ratio(np, nc), dn, nc))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    best_ratio, best_dn, best_nc = scored[0]
    second_ratio = scored[1][0] if len(scored) > 1 else 0.0
    second_dn = scored[1][1] if len(scored) > 1 else None

    if best_ratio < threshold:            # global threshold
        return None
    best_tokens = best_nc.split(" ")
    if len(best_tokens) != len(np_tokens):  # GUARD 3: equal token count
        return None
    # GUARD 4 (load-bearing): per-token alignment. Every differing token pair must be
    # a known OCR confusion or itself highly similar; a genuinely distinct token forces
    # CREATE (blocks Schmidt/Schmitt, Mueller/Moeller, ABC/ABD ...).
    for t1, t2 in zip(np_tokens, best_tokens):
        if t1 == t2 or _ocr_equiv(t1, t2):
            continue
        if _ratio(t1, t2) >= _TOKEN_FLOOR:
            continue
        return None

    return MatchResult(
        matched_name=best_dn,
        ratio=best_ratio,
        reason="fuzzy_high",
        runner_up=second_dn,
        runner_up_ratio=second_ratio,
    )
