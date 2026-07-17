"""Cross-step utility helpers shared by main + step scripts.

Why this exists
---------------
A handful of small functions used to live as private copies in two or more
files (main.py vs 6.generate_docs.py most often) and drift independently.
The earliest case was ``normalize_arxiv_id`` — main.py handled ``arxiv:``
and ``v\\d+`` suffix, 6.generate_docs.py did not. Step scripts re-
implemented URL shapes the upstream caller never sees.

Rules
-----
- No business logic. Only stateless conversions of values (strings, ints,
  booleans) and tiny IO wrappers.
- Stdlib only. Step scripts already import one another across ``src.*``;
  pulling in ``requests`` or ``arxiv`` here would force a transitive upgrade.
- Keep functions pure (no ``os.environ`` lookups beyond ``DPR_*`` env
  names that pre-existed in callers).

Re-exports from this module should be considered stable; renaming a
function will require updating all callers, so prefer adding a new
function and deprecating the old one in-place.
"""
from __future__ import annotations

import re
from typing import Any


_ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5})(?:v\d+)?$")


def normalize_arxiv_id(value: Any) -> str:
    r"""Return the canonical arXiv id (e.g. ``1706.03762``) for any of:

    - bare id: ``1706.03762`` / ``1706.03762v1``
    - ``arxiv:1706.03762`` (with optional v#)
    - URL: ``https://arxiv.org/abs/1706.03762v1`` /
      ``https://arxiv.org/pdf/1706.03762v1.pdf`` /
      ``http://arxiv.org/pdf/1706.03762``
    - empty / None → ``""``

    Case-insensitive. Strips query string and trailing ``.pdf``. If the
    tail is not a valid arXiv id, returns whatever the input was (lower-
    cased & stripped) so callers can still log the offending string.

    Byte-equivalent (in semantics) to the union of:

    - ``src/main.py:239`` (handles ``arxiv:``, ``/abs/``, ``/pdf/``, ``v\d+``)
    - ``src/6.generate_docs.py:235`` (handles ``http://`` + ``abs/``/``pdf/``,
      ``.pdf`` suffix). 6.generate_docs.py:235's version failed on
      ``arxiv:`` prefix and on ``v#`` suffix; main.py:239 covers both.
    """
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if text.startswith("arxiv:"):
        text = text.split(":", 1)[1].strip()
    if text.startswith("http://") or text.startswith("https://"):
        # Drop query string / fragment, trailing slash.
        text = text.split("?", 1)[0].split("#", 1)[0]
        text = text.rstrip("/")
        if "/abs/" in text:
            text = text.rsplit("/abs/", 1)[-1]
        elif "/pdf/" in text:
            text = text.rsplit("/pdf/", 1)[-1]
        else:
            text = text.rsplit("/", 1)[-1]
    if text.endswith(".pdf"):
        text = text[: -len(".pdf")]
    text = text.strip()
    matched = _ARXIV_ID_RE.match(text)
    if matched:
        return matched.group(1)
    return text
