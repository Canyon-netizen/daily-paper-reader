"""Helpers for keeping TeX-rich paper titles usable as plain text.

Paper metadata may legitimately contain inline TeX (for example
``$\\max$@$k$``).  The raw value is retained for provenance and rich
rendering, while this module provides the deterministic plain-text variant
used by YAML metadata, filenames, search labels, and accessibility text.
"""
from __future__ import annotations

import re
from typing import Match


_LATEX_SYMBOLS = {
    "alpha": "alpha",
    "beta": "beta",
    "gamma": "gamma",
    "delta": "delta",
    "epsilon": "epsilon",
    "varepsilon": "epsilon",
    "theta": "theta",
    "lambda": "lambda",
    "mu": "mu",
    "pi": "pi",
    "sigma": "sigma",
    "phi": "phi",
    "varphi": "phi",
    "omega": "omega",
    "neq": "≠",
    "ne": "≠",
    "leq": "≤",
    "le": "≤",
    "geq": "≥",
    "ge": "≥",
    "pm": "±",
    "times": "×",
    "cdot": "·",
    "rightarrow": "→",
    "to": "→",
    "infty": "∞",
    "partial": "∂",
    "sum": "∑",
    "prod": "∏",
    "max": "max",
    "min": "min",
}

# Formatting commands whose braces should simply disappear while preserving
# their contents.  The generic command fallback below handles unknown wrappers
# in the same way, but spelling these out documents the intended behavior.
_WRAPPER_COMMANDS = {
    "mathrm",
    "mathbf",
    "mathit",
    "mathsf",
    "mathtt",
    "mathbb",
    "mathcal",
    "mathscr",
    "operatorname",
    "text",
    "textbf",
    "textrm",
    "boldsymbol",
    "bm",
}

_MATH_DELIMITER_RE = re.compile(
    r"\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\\\(([^\n]*?)\\\)|\\\[([\s\S]*?)\\\]"
)
_COMMAND_RE = re.compile(r"\\([A-Za-z]+)")


def _strip_latex_expression(expr: str) -> str:
    text = str(expr or "")
    # TeX spacing commands do not carry visible title information.
    text = re.sub(r"\\[,;:!> ]", " ", text)
    text = text.replace("~", " ")

    def command(match: Match[str]) -> str:
        name = match.group(1)
        if name in _LATEX_SYMBOLS:
            return _LATEX_SYMBOLS[name]
        if name in _WRAPPER_COMMANDS:
            return ""
        if name in {"left", "right", "middle", "displaystyle", "limits"}:
            return ""
        # Unknown commands are kept as their readable name rather than
        # leaking a backslash into a plain UI label.
        return name

    text = _COMMAND_RE.sub(command, text)
    # Superscript/subscript markers and grouping braces are meaningful in TeX
    # but not useful in a compact title label.  Keep their content.
    text = re.sub(r"[{}^_]", "", text)
    text = re.sub(r"\\([^A-Za-z])", r"\1", text)
    return text


def strip_title_markup(value: object) -> str:
    """Return a readable plain-text title without changing the raw source.

    Paired TeX delimiters are converted first, so ``$\\max$@$k$`` becomes
    ``max@k``.  Unpaired dollar signs are removed as a final defensive step;
    this keeps malformed upstream metadata from polluting browser titles and
    search labels.
    """
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")

    def replace_math(match: Match[str]) -> str:
        expr = next((group for group in match.groups() if group is not None), "")
        return _strip_latex_expression(expr)

    text = _MATH_DELIMITER_RE.sub(replace_math, text)
    text = text.replace("$", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


__all__ = ["strip_title_markup"]
