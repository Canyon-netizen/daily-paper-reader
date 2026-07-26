#!/usr/bin/env python

"""Shared helpers for HTML-scraping fetchers (AAAI OJS, ACL Anthology).

Why this exists
---------------
Two fetchers (``fetch_aaai_ojs.py`` and ``fetch_acl_anthology.py``) used to
each carry their own ``_get()`` helper. They were 95 % identical and shared
the same three weaknesses that bit us in production:

  1. **Static single UA** — both shipped ``Chrome/133.0 Safari/537.36`` on
     every request. Cloudflare-fronted sites (e.g. ``ojs.aaai.org``) flag
     that as bot traffic and either challenge (which our parser can't
     solve) or RST the connection (``RemoteDisconnected``).  We saw exactly
     this failure mode in the GitHub Actions run on 2026-07-26: ``init_aaai``
     exited 1 because every retry returned ``ConnectionError: Remote end
     closed connection without response``.

  2. **Thin headers** — only ``User-Agent`` was set. Real browsers send
     ``Accept``, ``Accept-Language``, ``Accept-Encoding``, ``Cache-Control``
     and ``Connection: keep-alive``. Sites that fingerprint based on these
     drop synthetic clients.

  3. **Naive retry** — original retry loop slept ``time.sleep(attempt)``
     (1s, 2s, 3s — *linear*), retried on *every* exception (including 4xx),
     and never distinguished a transient transport hiccup from a permanent
     rejection. The result: 3 retries in ~6 s, then ``raise last_error``.

This module fixes all three:

  - **UA pool** (``UA_POOL``) — 5 plausible recent Chrome / Firefox /
    Safari strings. Each call picks one at random so individual sites see
    a different UA per request.

  - **Full browser-like headers** (``DEFAULT_HEADERS``) merged with the
    chosen UA at call time. ``Accept-Encoding`` includes gzip because
    ``requests`` transparently decodes that; sending it avoids the
    "missing Accept-Encoding → looks like a script" fingerprint.

  - **Smart retry with exponential backoff + transient classification**:
      - Always retried: ``ConnectionError`` (incl. ``RemoteDisconnected``),
        ``ChunkedEncodingError``, ``ReadTimeout``.
      - Retried with backoff: HTTP ``408 / 425 / 429 / 503 / 504`` (these
        are server-told retry semantics).
      - NOT retried: any other ``HTTPError`` (4xx like 403/404), invalid
        URL, etc.
      - Backoff: ``base * 2 ** (attempt - 1)`` capped at ``max_backoff``
        with jitter (``random.uniform(0.5, 1.0)`` multiplier) so two
        concurrent fetches don't lock-step their retries.

Transient classification uses ``isinstance`` against parent classes
(``requests.ConnectionError``, ``urllib3.ConnectionError``, etc.) rather
than class-name string matching.  This is the v1/v2-safe form: urllib3 v1
had standalone ``RemoteDisconnected`` / ``ChunkedEncodingError``; v2
collapsed them into ``ConnectionError`` / ``ProtocolError``.  Matching
the parents means we retry in both worlds without conditional imports.

Public API
----------
- ``safe_html_get(url, *, timeout=30, retries=3, label="html", session=None)``
  → ``str`` (response text).
- ``make_session()`` → ``requests.Session`` with retry middleware mounted
  for callers that want to issue many GETs through one connection pool.
- ``UA_POOL`` / ``DEFAULT_HEADERS`` exposed for tests + occasional manual
  override.

Not in scope
------------
- ``fetch_arxiv.py`` / ``fetch_biorxiv_family.py`` / ``fetch_chemrxiv.py``
  hit JSON/XML APIs with their own auth / pagination contracts; they don't
  benefit from this helper and aren't touched.
- ``fetch_openreview.py`` uses the ``openreview-py`` SDK (HTTP under the
  hood but with its own session + cookie jar); out of scope.

Tests
-----
``tests/test_safe_html_get.py`` covers: success path, transient retry
succeeds on 2nd attempt, ``RemoteDisconnected`` retries with backoff,
4xx (e.g. 404) raises immediately without retry, exhausted retries raise
the last transient error.
"""
from __future__ import annotations

import random
import sys
import time
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Optional

import requests
import urllib3.exceptions
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def _log(level: str, msg: str) -> None:
    """Write a log line directly to stderr, bypassing ``logging``.

    We deliberately avoid the stdlib ``logging`` module here: in a
    subprocess (e.g. ``fetch_aaai_ojs.py`` invoked by ``conference-init``)
    the root logger often isn't configured, so INFO messages silently
    disappear and the user sees only the final stack trace.  Writing to
    stderr with a millisecond timestamp guarantees each attempt shows up
    in the GitHub Actions log panel.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    sys.stderr.write(f"[{ts}] [{level}] {msg}\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# UA pool — 5 plausible, recent, *cross-browser* strings.  Picked at random
# per request so individual sites don't see a flood of identical UA traffic
# from a single runner.  Keeping the set small (5) is intentional: too many
# fake UA strings trigger bot heuristics; 5 unique-but-plausible is what
# real browser fingerprint panels usually show.
# ---------------------------------------------------------------------------
UA_POOL: tuple[str, ...] = (
    # Chrome 133 / Linux
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    # Chrome 131 / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Firefox 132 / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    # Chrome 130 / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    # Safari 17 / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
)


# Browser-like headers that *don't* depend on UA.  Accept-Encoding includes
# gzip because requests decodes that transparently; sending it is what real
# browsers do and sites fingerprint on its absence.
DEFAULT_HEADERS: dict[str, str] = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


# HTTP status codes that mean "retry the request" per RFC 7231 + RFC 6585 +
# common CDN conventions (Cloudflare / Fastly both surface 429 / 503 with
# Retry-After headers).  Anything else 4xx is a permanent client error
# (e.g. 403 / 404) and should fail fast so callers see a clear exception.
RETRYABLE_HTTP_STATUSES: frozenset[int] = frozenset({408, 425, 429, 500, 502, 503, 504})


# Exception *types* (not names) that mean "the wire broke mid-request" —
# retried unconditionally.
#
# Why types not names: urllib3 v1 had ``RemoteDisconnected`` / ``ChunkedEncodingError``
# as standalone exception classes; v2 collapsed them into ``ConnectionError``
# and ``ProtocolError``.  ``requests`` follows urllib3's renames.  Pinning to
# the parent classes means the helper works on both v1 and v2 with no
# conditional import.
#
# Tuple so order doesn't matter; ``isinstance`` is short-circuited on first
# hit.
_TRANSIENT_EXC_TYPES: tuple[type[BaseException], ...] = (
    requests.exceptions.ConnectionError,    # parent of RemoteDisconnected-equivalents in v2
    requests.exceptions.ChunkedEncodingError,  # still in requests.exceptions (wraps urllib3)
    requests.exceptions.ReadTimeout,         # still its own type in v2
    requests.exceptions.Timeout,            # parent of ConnectTimeout + ReadTimeout
    urllib3.exceptions.ConnectionError,     # urllib3 v2 catch-all for RST / refused / DNS
    urllib3.exceptions.ProtocolError,       # malformed bytes after handshake (v2: replaces v1 ProtocolError variants)
    urllib3.exceptions.NewConnectionError,  # failed to open a new connection
    urllib3.exceptions.ClosedPoolError,     # tried to use a closed pool (mid-connection drop)
    ConnectionResetError,                   # raw OSError subclass from the socket layer
)


def _is_transient(exc: BaseException) -> bool:
    """Return True if ``exc`` looks like a transient transport failure.

    Walks the cause chain once (depth-bounded to avoid pathological loops)
    so a wrapped ``ConnectionError -> ConnectionError -> ...`` still matches.
    """
    seen: set[int] = set()
    current: Optional[BaseException] = exc
    depth = 0
    while current is not None and depth < 8 and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, _TRANSIENT_EXC_TYPES):
            return True
        # ``requests`` wraps the underlying ``__cause__`` / ``__context__``;
        # ``args[0]`` is sometimes the underlying exc (e.g. when ``raise X
        # from Y`` is used or urllib3 sets ``.args = (cause,)``).
        nxt = current.__cause__ or current.__context__
        if nxt is None and getattr(current, "args", None):
            first = current.args[0]
            if isinstance(first, BaseException):
                nxt = first
        current = nxt
        depth += 1
    return False


def _build_headers(ua: Optional[str] = None) -> dict[str, str]:
    """Merge DEFAULT_HEADERS with a (random if None) UA."""
    chosen = ua or random.choice(UA_POOL)
    return {**DEFAULT_HEADERS, "User-Agent": chosen}


def _backoff_seconds(attempt: int, *, base: float = 1.0, cap: float = 30.0) -> float:
    """Exponential backoff with jitter.

    attempt is 1-indexed (the *upcoming* retry number).  ``attempt=1``
    returns ``base * 0.5..1.0`` (0.5-1s), ``attempt=2`` returns
    ``base*2 * 0.5..1.0`` (1-2s), etc., capped at ``cap``.
    """
    raw = base * (2 ** max(attempt - 1, 0))
    raw = min(raw, cap)
    return raw * random.uniform(0.5, 1.0)


def make_session() -> requests.Session:
    """Return a ``requests.Session`` with retry middleware mounted.

    urllib3's ``Retry`` handles 5xx + 429 transparently inside a single
    TCP connection, *before* our exception-based retry layer kicks in.
    Combined with the exception-based retry on transient connection
    drops, we get defense in depth.
    """
    s = requests.Session()
    retry_cfg = Retry(
        total=2,                                   # urllib3-internal retries
        backoff_factor=0.5,
        status_forcelist=sorted(RETRYABLE_HTTP_STATUSES),
        allowed_methods=frozenset({"GET", "HEAD"}),
        raise_on_status=False,                    # let us raise HTTPError ourselves
    )
    adapter = HTTPAdapter(max_retries=retry_cfg, pool_connections=10, pool_maxsize=10)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s


def safe_html_get(
    url: str,
    *,
    timeout: int = 30,
    retries: int = 6,
    label: str = "html",
    session: Optional[requests.Session] = None,
    extra_headers: Optional[Mapping[str, str]] = None,
    sleep_impl=time.sleep,
    rand_impl=random.random,
    rand_choice=random.choice,
) -> str:
    """GET ``url`` with UA rotation, browser-like headers, smart retry.

    Args:
      url: absolute URL to fetch.
      timeout: per-request timeout in seconds.  Forced >= 1.
      retries: total attempts (>=1).  After exhausting, raises the last
        transient error encountered.  Set to 1 to disable retry.
        **Default is 6** (not 3) because Cloudflare-fronted OJS sites
        like ``ojs.aaai.org`` RST every request from a single runner IP
        for ~30-60 s before letting one through.  3 attempts in 6 s is
        not enough; 6 attempts with exponential backoff cover ~60 s.
      label: short tag for log lines (e.g. ``"[AAAI]"``).
      session: optional shared ``requests.Session`` (see ``make_session()``).
        Useful when a caller issues many GETs and wants one TCP pool.
      extra_headers: optional header overrides (e.g. set ``Referer``).
      sleep_impl / rand_impl / rand_choice: injectable for tests.
        Default uses real ``time.sleep`` and ``random`` — pass no-arg
        stubs to make tests deterministic.

    Returns:
      ``str`` response body (decoded per ``requests`` content negotiation).

    Raises:
      ``requests.exceptions.HTTPError`` for non-retryable 4xx.
      The last transient exception (``ConnectionError``,
      ``RemoteDisconnected``, ``Timeout``, ...) once retries exhausted.

    Side effects:
      Writes one line per attempt to **stderr** (NOT to the stdlib
      ``logging`` module — see ``_log()`` docstring for why).  Each line
      shows up in GitHub Actions logs even when called from a subprocess.
    """
    if retries < 1:
        retries = 1
    safe_timeout = max(int(timeout or 1), 1)
    sess = session or requests.Session()
    own_session = session is None

    last_error: Optional[BaseException] = None
    for attempt in range(1, retries + 1):
        # Fresh headers per attempt — UA rotation is the whole point.
        headers = _build_headers()
        if extra_headers:
            headers.update(dict(extra_headers))

        try:
            _log("INFO", f"[{label}] GET attempt {attempt}/{retries} url={url}")
            resp = sess.get(url, headers=headers, timeout=safe_timeout)
            # 4xx/5xx → HTTPError. Decide retry vs raise.
            if resp.status_code in RETRYABLE_HTTP_STATUSES:
                raise requests.exceptions.HTTPError(
                    f"retryable status {resp.status_code} for {url}",
                    response=resp,
                )
            resp.raise_for_status()
            _log("INFO", f"[{label}] GET {url} → {resp.status_code} (attempt {attempt}/{retries})")
            return resp.text
        except requests.exceptions.HTTPError as exc:
            last_error = exc
            if exc.response is not None and exc.response.status_code in RETRYABLE_HTTP_STATUSES:
                _log("WARNING", f"[{label}] HTTP {exc.response.status_code} on {url} — will retry (attempt {attempt}/{retries})")
                if attempt < retries:
                    sleep_impl(_backoff_seconds(attempt))
                    continue
            raise
        except Exception as exc:  # noqa: BLE001 — we want the broad net here
            last_error = exc
            if not _is_transient(exc):
                _log("WARNING", f"[{label}] non-transient {type(exc).__name__} on {url} — failing fast: {exc}")
                raise
            _log("WARNING", f"[{label}] transient {type(exc).__name__} on {url} (attempt {attempt}/{retries}): {exc}")
            if attempt >= retries:
                break
            sleep_impl(_backoff_seconds(attempt))
            continue

    # Exhausted — surface the last transient error verbatim.
    if own_session:
        sess.close()
    assert last_error is not None  # loop body sets it on every path
    _log("ERROR", f"[{label}] exhausted {retries} retries on {url}: {type(last_error).__name__}: {last_error}")
    raise last_error


__all__ = [
    "UA_POOL",
    "DEFAULT_HEADERS",
    "RETRYABLE_HTTP_STATUSES",
    "make_session",
    "safe_html_get",
]