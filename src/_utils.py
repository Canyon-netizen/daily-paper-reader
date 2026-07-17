"""Cross-step utility helpers shared by main + step scripts.

Why this exists
---------------
A handful of small functions used to live as private copies in two or more
files (main.py vs 6.generate_docs.py most often) and drift independently.
The earliest case was ``normalize_arxiv_id`` — main.py handled ``arxiv:``
and ``v\\d+`` suffix, 6.generate_docs.py did not. Step scripts re-
implemented URL shapes the upstream caller never sees.

The second slice is the trio ``log`` / ``group_start`` / ``group_end``:
byte-identical in every step script (``0``, ``2.3``, ``3``, ``4``, ``5``)
and configurable only via the print statements' GitHub Actions fold
markers. Step scripts also each carry their own ``load_json`` /
``save_json``, but those vary by caller (2-space vs 4-space indent,
Chinese vs English error messages, with or without an auto-log on save),
so they stay local — calling code that wants the common helper imports
``from src._utils import log`` and stays in charge of IO.

Rules
-----
- No business logic. Only stateless conversions of values (strings, ints,
  booleans) and tiny IO wrappers.
- Stdlib only. Step scripts already import one another across ``src.*``;
  pulling in ``requests`` or ``arxiv`` here would force a transitive upgrade.
- Keep functions pure (no ``os.environ`` lookups beyond ``DPR_*`` env
  names that pre-existed in callers).
- 2-space indent inside this module so it matches ``0`` / ``2.3`` / ``3``
  (the first set of step scripts to copy these helpers). 4-space files
  (``4``, ``5``) are aggressively linted on import-export pairs and will
  be re-indented by their owners when they switch.

Re-exports from this module should be considered stable; renaming a
function will require updating all callers, so prefer adding a new
function and deprecating the old one in-place.
"""
from __future__ import annotations

import datetime as _dt
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


# --- run-output helpers (log + GitHub Actions fold group markers) ---
#
# Byte-equivalent to the trio that lived in every step script before this
# module existed. 4-space-indented callers (``4``, ``5``) accept the
# switch to 2-space because the function *body* stays in this module — the
# import site is the only place the indent choice becomes visible.


def log(message: str) -> None:
  ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
  print(f"[{ts}] {message}", flush=True)


def group_start(title: str) -> None:
  print(f"::group::{title}", flush=True)


def group_end() -> None:
  print("::endgroup::", flush=True)
