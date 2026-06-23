"""Legal-form stripping for correspondent names.

Leaf module: imports only the stdlib. It is deliberately dependency-free so that
both ``service.py`` and ``correspondent_matcher.py`` can import ``_strip_legal_forms``
without creating an import cycle (service.py imports the matcher, the matcher needs
legal-form stripping — routing both through this leaf module keeps the graph acyclic).
"""

import re

# ── Legal form stripping ───────────────────────────────────────────────────────
# Ordered longest-first so "GmbH & Co. KG" is matched before "GmbH" or "KG"
_LEGAL_FORMS = [
    r"GmbH\s*&\s*Co\.?\s*KGaA",
    r"GmbH\s*&\s*Co\.?\s*KG",
    r"GmbH\s*&\s*Co\.?",
    r"AG\s*&\s*Co\.?\s*KG",
    r"UG\s*\(haftungsbeschr[äa]nkt\)",
    r"GmbH",
    r"AG",
    r"KGaA",
    r"KG",
    r"OHG",
    r"GbR",
    r"e\.?\s*V\.?",
    r"e\.?\s*G\.?",
    r"e\.?\s*K\.?",
    r"SE",
    r"UG",
    r"mbH",
    r"Ltd\.?",
    r"Inc\.?",
    r"Corp\.?",
    r"P\.?L\.?C\.?",
    r"SARL",
    r"S\.?\s*A\.?",
    r"N\.?\s*V\.?",
    r"B\.?\s*V\.?",
    r"i\.?\s*Gr\.?",      # in Gründung
    r"i\.?\s*L\.?",       # in Liquidation
]
_LEGAL_SUFFIX_RE = re.compile(
    r"[\s,]+(" + "|".join(_LEGAL_FORMS) + r")\s*$",
    re.IGNORECASE,
)


def _strip_legal_forms(name: str) -> str:
    """Remove German/international legal form suffixes from a company name."""
    if not name:
        return name
    # Apply up to 3 times to strip chained suffixes like "GmbH & Co. KG"
    for _ in range(3):
        stripped = _LEGAL_SUFFIX_RE.sub("", name).strip(" ,.")
        if stripped == name:
            break
        name = stripped
    return name.strip()
