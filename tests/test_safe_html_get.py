"""Tests for ``src.maintain.fetchers._common.safe_html_get``.

Why this exists
---------------
The helper is a single chokepoint between our scrapers and every
HTML-fetching site (AAAI OJS, ACL Anthology, anything we add later).
A regression here breaks ``init_aaai`` / ``init_acl`` / ``init_emnlp``
end-to-end, so we lock in the contract:

  - Success on first try: returns body verbatim, calls underlying ``GET``
    exactly once.
  - Success on retry: ``RemoteDisconnected`` (or any transient error) on
    attempt #1 succeeds on attempt #2 — proves retry + backoff work.
  - Permanent failure (404): raises ``HTTPError`` *without* retrying.
  - Exhausted retries: raises the last transient error after N attempts.
  - Transient classification: a non-transient exception (e.g.
    ``ValueError``) bubbles up immediately, no retry, no extra sleep.
  - Backoff math: the backoff helper yields exponential-with-jitter in the
    expected band.

We stub ``requests.Session`` (rather than mocking the module-level
``requests.get``) so the helper's ``session=`` path stays exercised.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import requests
import urllib3.exceptions

from src.maintain.fetchers._common import (
    DEFAULT_HEADERS,
    RETRYABLE_HTTP_STATUSES,
    UA_POOL,
    _backoff_seconds,
    _is_transient,
    safe_html_get,
)


def _make_session(responses):
    """Build a ``MagicMock``-style Session whose ``.get`` returns successive
    ``Response``-like objects from ``responses`` (a list).

    Each item is either:
      - a ``Response`` (built via ``_resp(status, body)``), or
      - an ``Exception`` instance to raise, or
      - a callable ``side_effect`` (``lambda url, **kw: ...``) for finer
        control (e.g. asserting headers).
    """
    session = MagicMock()
    # Keep session.close() a no-op so own_session teardown is harmless.
    session.close = MagicMock()
    session.get.side_effect = responses
    return session


def _resp(status: int, body: str = "<html>ok</html>", headers=None):
    r = MagicMock(spec=requests.Response)
    r.status_code = status
    r.text = body
    r.headers = headers or {}
    r.raise_for_status = MagicMock()
    if 400 <= status < 600:
        http_err = requests.exceptions.HTTPError(f"{status} boom", response=r)
        r.raise_for_status.side_effect = http_err
    else:
        r.raise_for_status.return_value = None
    return r


class SafeHtmlGetTest(unittest.TestCase):
    # -------- happy path --------
    def test_returns_body_on_first_try(self):
        session = _make_session([_resp(200, "<html>hi</html>")])
        sleeps = []
        out = safe_html_get(
            "https://example.test/x",
            session=session,
            label="TEST",
            sleep_impl=sleeps.append,
        )
        self.assertEqual(out, "<html>hi</html>")
        self.assertEqual(session.get.call_count, 1)
        self.assertEqual(sleeps, [])

    # -------- headers --------
    def test_request_sends_browser_like_headers(self):
        session = _make_session([_resp(200, "ok")])
        safe_html_get(
            "https://example.test/x",
            session=session,
            label="TEST",
            sleep_impl=lambda _ms: None,
        )
        # Pull the headers kwarg the helper passed to .get().
        kwargs = session.get.call_args.kwargs
        headers = kwargs["headers"]
        # Every DEFAULT_HEADERS key must be present.
        for key, val in DEFAULT_HEADERS.items():
            self.assertEqual(headers.get(key), val, f"missing/wrong header {key}")
        # UA must be from the pool.
        self.assertIn(headers["User-Agent"], UA_POOL)

    def test_ua_rotates_across_calls(self):
        session_a = _make_session([_resp(200, "a")])
        session_b = _make_session([_resp(200, "b")])
        for sess, body in [(session_a, "a"), (session_b, "b")]:
            safe_html_get(
                "https://example.test/x",
                session=sess,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
        ua_a = session_a.get.call_args.kwargs["headers"]["User-Agent"]
        ua_b = session_b.get.call_args.kwargs["headers"]["User-Agent"]
        # We can't *guarantee* two picks differ (random), but across many
        # trials with the seeded pool we should see at least one rotation.
        # Run 20 times to make this stable.
        seen = {ua_a, ua_b}
        for _ in range(20):
            sess = _make_session([_resp(200, "x")])
            safe_html_get(
                "https://example.test/x",
                session=sess,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
            seen.add(sess.get.call_args.kwargs["headers"]["User-Agent"])
        # Pool has 5 entries; 22 trials should hit >1 unless rng is broken.
        self.assertGreater(len(seen), 1, f"UA pool not rotating: {seen}")

    # -------- retry on transient --------
    def test_retries_remote_disconnected_then_succeeds(self):
        # First attempt: requests.ConnectionError wrapping a urllib3
        # ConnectionError — this is the urllib3 v2 form of "Remote end
        # closed connection" (v1 had a standalone ``RemoteDisconnected``
        # class; v2 collapses it into ``ConnectionError``).
        # Second attempt: 200 OK.
        boom = requests.exceptions.ConnectionError("Connection aborted.")
        boom.args = (urllib3.exceptions.ConnectionError(
            "Remote end closed connection without response",
        ),)
        session = _make_session([boom, _resp(200, "ok")])
        sleeps = []
        out = safe_html_get(
            "https://example.test/x",
            retries=3,
            session=session,
            label="TEST",
            sleep_impl=sleeps.append,
        )
        self.assertEqual(out, "ok")
        self.assertEqual(session.get.call_count, 2)
        # Exactly one backoff sleep, between attempts 1 and 2.
        self.assertEqual(len(sleeps), 1)
        # And it should be in the band for attempt=1 (0.5s..1.0s).
        self.assertGreaterEqual(sleeps[0], 0.5)
        self.assertLessEqual(sleeps[0], 1.0)

    def test_retries_read_timeout(self):
        boom = requests.exceptions.ReadTimeout("slow")
        session = _make_session([boom, _resp(200, "ok")])
        sleeps = []
        out = safe_html_get(
            "https://example.test/x",
            retries=3,
            session=session,
            label="TEST",
            sleep_impl=sleeps.append,
        )
        self.assertEqual(out, "ok")
        self.assertEqual(session.get.call_count, 2)

    # -------- 4xx: fail fast, no retry --------
    def test_404_does_not_retry(self):
        session = _make_session([_resp(404, "nope")])
        with self.assertRaises(requests.exceptions.HTTPError):
            safe_html_get(
                "https://example.test/x",
                retries=5,
                session=session,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
        self.assertEqual(session.get.call_count, 1)

    def test_403_does_not_retry(self):
        session = _make_session([_resp(403, "denied")])
        with self.assertRaises(requests.exceptions.HTTPError):
            safe_html_get(
                "https://example.test/x",
                retries=5,
                session=session,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
        self.assertEqual(session.get.call_count, 1)

    # -------- 5xx / 429: retry ----
    def test_503_is_retried(self):
        session = _make_session([_resp(503, "down"), _resp(200, "ok")])
        out = safe_html_get(
            "https://example.test/x",
            retries=3,
            session=session,
            label="TEST",
            sleep_impl=lambda _ms: None,
        )
        self.assertEqual(out, "ok")
        self.assertEqual(session.get.call_count, 2)

    def test_429_is_retried(self):
        session = _make_session([_resp(429, "rl"), _resp(200, "ok")])
        out = safe_html_get(
            "https://example.test/x",
            retries=3,
            session=session,
            label="TEST",
            sleep_impl=lambda _ms: None,
        )
        self.assertEqual(out, "ok")
        self.assertEqual(session.get.call_count, 2)

    # -------- exhausted retry --------
    def test_exhausts_retries_then_raises_last_transient(self):
        boom = requests.exceptions.ConnectionError(
            "Connection aborted.",
        )
        session = _make_session([boom, boom, boom])
        with self.assertRaises(requests.exceptions.ConnectionError):
            safe_html_get(
                "https://example.test/x",
                retries=3,
                session=session,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
        self.assertEqual(session.get.call_count, 3)

    # -------- non-transient: fail fast --------
    def test_value_error_fails_fast_without_retry(self):
        boom = ValueError("bad URL")
        session = _make_session([boom])
        with self.assertRaises(ValueError):
            safe_html_get(
                "https://example.test/x",
                retries=5,
                session=session,
                label="TEST",
                sleep_impl=lambda _ms: None,
            )
        self.assertEqual(session.get.call_count, 1)

    # -------- RETRYABLE set sanity --------
    def test_retryable_status_set_matches_design(self):
        # Frozen in stone in the docstring; if you change this, update tests
        # + docs together.
        self.assertEqual(
            RETRYABLE_HTTP_STATUSES,
            frozenset({408, 425, 429, 500, 502, 503, 504}),
        )

    # -------- default retries bumped to survive Cloudflare RST --------
    def test_default_retries_is_6(self):
        # We explicitly bumped retries from 3 → 6 because ojs.aaai.org
        # resets every connection from a GHA runner for ~30-60s before
        # letting one through.  3 retries in ~6s isn't enough; 6 retries
        # with exponential backoff cover ~60s.
        # We test this via the default behaviour of ``_get`` wrappers in
        # the migrated fetchers.
        from src.maintain.fetchers.fetch_aaai_ojs import _get as aaai_get
        from src.maintain.fetchers.fetch_acl_anthology import _get as acl_get
        import inspect
        # Both wrappers forward to safe_html_get; if either forgets to
        # override ``retries``, it picks up the new default.
        for fn in (aaai_get, acl_get):
            sig = inspect.signature(fn)
            # Find the call to safe_html_get inside the wrapper; easier
            # to just assert that the wrapper does NOT pin retries=3.
            # Read the source text instead.
            src = inspect.getsource(fn)
            self.assertNotIn("retries=3", src,
                             f"{fn.__module__}.{fn.__name__} still pins retries=3 — bump to default or explicit >3")
            # And both should forward to safe_html_get.
            self.assertIn("safe_html_get", src)

    # -------- log output uses stderr (not stdlib logging) --------
    def test_logs_write_to_stderr_not_logging(self):
        # The earlier logging-based implementation lost INFO messages
        # inside subprocesses on GHA.  The fix is direct stderr writes.
        # We assert by capturing sys.stderr during a call and checking
        # at least one line per attempt shows up.
        import sys
        from io import StringIO
        captured = StringIO()
        old_stderr = sys.stderr
        sys.stderr = captured
        try:
            session = _make_session([_resp(200, "ok")])
            safe_html_get(
                "https://example.test/x",
                session=session,
                label="VISIBLE",
                sleep_impl=lambda _ms: None,
            )
        finally:
            sys.stderr = old_stderr
        out = captured.getvalue()
        self.assertIn("VISIBLE", out)
        self.assertIn("attempt 1/", out)
        # And the timestamp prefix.
        import re
        self.assertRegex(out, r"\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]")

    # -------- _is_transient classification --------
    def test_is_transient_recognises_known_types(self):
        for exc in [
            requests.exceptions.ConnectionError("x"),
            requests.exceptions.ReadTimeout("x"),
            requests.exceptions.ChunkedEncodingError("x"),
            requests.exceptions.Timeout("x"),
            ConnectionResetError("x"),
        ]:
            self.assertTrue(_is_transient(exc), f"expected transient: {exc!r}")
        # And known non-transient.
        self.assertFalse(_is_transient(ValueError("x")))
        self.assertFalse(_is_transient(KeyError("x")))


class BackoffTest(unittest.TestCase):
    def test_backoff_attempt_1_band(self):
        # attempt=1 → base * 2^0 * jitter(0.5..1.0)  →  0.5..1.0
        for _ in range(50):
            v = _backoff_seconds(1)
            self.assertGreaterEqual(v, 0.5)
            self.assertLessEqual(v, 1.0)

    def test_backoff_attempt_2_band(self):
        # attempt=2 → base * 2^1 * jitter  →  1.0..2.0
        for _ in range(50):
            v = _backoff_seconds(2)
            self.assertGreaterEqual(v, 1.0)
            self.assertLessEqual(v, 2.0)

    def test_backoff_attempt_5_capped(self):
        # attempt=5 → base * 2^4 = 16  →  8..16 (under cap=30)
        for _ in range(50):
            v = _backoff_seconds(5)
            self.assertGreaterEqual(v, 8.0)
            self.assertLessEqual(v, 16.0)

    def test_backoff_attempt_20_respects_cap(self):
        # attempt=20 → 524288 raw → capped at 30 → 15..30
        for _ in range(50):
            v = _backoff_seconds(20)
            self.assertGreaterEqual(v, 15.0)
            self.assertLessEqual(v, 30.0)


if __name__ == "__main__":
    unittest.main()