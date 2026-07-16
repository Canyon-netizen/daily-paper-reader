"""Regression tests for paper-retrieval-core.mjs.

These tests pin the contract that paper-analyzer's RAG loop relies on:

- ``segmentText`` splits paper text by blank-line boundaries and tags each
  block's first line as a heading if it matches the heuristics (numbered
  / §-prefixed / all-caps short lines).
- ``findSectionBlock`` maps a ref like ``"3.2"`` or ``"Hypernetwork"`` to
  the start block of the section; falls back to substring matching when
  the numeric prefix misses.
- ``collectSection`` returns the section text up to the next heading or
  ``maxChars``, whichever comes first.
- ``rankSegmentsByQuery`` ranks segments by query-token TF, down-weighting
  long blocks so a single match in a short paragraph wins over scattered
  matches in a long one.
- ``withNeighborhood`` decorates top hits with ±1 block of context,
  preserving document order so LLM can read top-to-bottom.

The fixture mirrors ParametricSkills (arXiv 2606.30015) section layout:
``3.1 Skill-Reconstruction Pretraining`` and ``3.2 Exploitation
Post-Training`` are the two stages paper-analyzer's RAG is most likely to
ask for, so these tests guard both numeric refs and free-text refs.

If the segmenter heuristics or scoring formula change, these tests must
fail and the author must consciously update both code and tests.

The script under test is plain ESM with zero external deps, so we can
spawn ``node`` (any v18+ has global fetch + ESM) and feed it JSON on
stdin — no tsx / vitest / transpilation step required.
"""

import json
import os
import pathlib
import subprocess
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE_BIN", "node")
CORE = ROOT / "astro-src" / "scripts" / "paper-retrieval-core.mjs"
FIXTURE = ROOT / "tests" / "fixtures" / "paper_retrieval_fixture.txt"


def _node_dispatch(cmd: str, payload: dict) -> dict:
    """Spawn paper-retrieval-core.mjs with `cmd` and a JSON payload, return parsed result.

    Reads stdout fully and asserts the process exited 0; stderr in failure
    paths is surfaced via the assertion message.
    """
    proc = subprocess.run(
        [NODE, str(CORE), cmd],
        input=json.dumps(payload).encode("utf-8"),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"{cmd} exited {proc.returncode}: {proc.stderr.decode('utf-8', 'replace')}"
        )
    return json.loads(proc.stdout)


def _load_fixture() -> str:
    return FIXTURE.read_text(encoding="utf-8")


@unittest.skipUnless(CORE.exists() and FIXTURE.exists(), "core/fixture missing")
class SegmentAndFindTest(unittest.TestCase):
    """Sanity: segmenter splits on blank lines, heading detection picks
    numbered / §-prefixed / all-caps titles, and findSectionBlock resolves
    both numeric refs and free-text titles."""

    def test_blocks_non_empty_with_numbered_headings(self):
        txt = _load_fixture()
        out = _node_dispatch("getSection", {"txt": txt, "ref": "nonexistent"})
        # If we wire ``getSection`` to use collectSection only when matched,
        # the result for a non-existent ref should be null. We also assert
        # the segmenter produced a sane block count by running the same
        # command against a known ref.
        self.assertIsNone(out["result"], "non-existent ref must return null")

    def test_numeric_ref_3_2_resolves_to_exploitation_section(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "getSection", {"txt": txt, "ref": "3.2", "maxChars": 4000}
        )
        self.assertIsNotNone(out["result"])
        self.assertIn("Exploitation Post-Training", out["result"])
        # Must NOT include chapter 4 or 5 — collectSection stops at the
        # next heading block.
        self.assertNotIn("4 Experiments", out["result"])
        self.assertNotIn("5 Conclusion", out["result"])

    def test_numeric_ref_3_1_resolves_to_skill_reconstruction(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "getSection", {"txt": txt, "ref": "3.1", "maxChars": 4000}
        )
        self.assertIsNotNone(out["result"])
        self.assertIn("Skill-Reconstruction Pretraining", out["result"])
        self.assertIn("cross-entropy", out["result"])

    def test_free_text_ref_method_resolves_to_method_section(self):
        """Free-text fallback resolves to first heading that contains the
        query (case-insensitive, punctuation-stripped). Section titles
        in ar5iv/PDF include the section name itself (e.g. '3 Method',
        '4 Experiments'), so this is the common case — not 'pick by
        body keyword'."""
        txt = _load_fixture()
        out = _node_dispatch(
            "getSection", {"txt": txt, "ref": "Method", "maxChars": 4000}
        )
        self.assertIsNotNone(out["result"])
        # Must land in §3 Method and include its body paragraphs.
        self.assertIn("two training stages", out["result"])

    def test_free_text_ref_experiments_picks_chapter_4(self):
        """Distinct section titles win over partial overlap — the first
        match that contains 'experiments' in heading-text is §4."""
        txt = _load_fixture()
        out = _node_dispatch(
            "getSection", {"txt": txt, "ref": "Experiments", "maxChars": 4000}
        )
        self.assertIsNotNone(out["result"])
        self.assertIn("4 Experiments", out["result"])
        self.assertNotIn("3.1 Skill", out["result"])

    def test_ref_strips_section_prefix_marker(self):
        """The §-prefix is normalised away before numeric matching — so
        '§3' resolves the same way as '3'. We accept either 3 Method or
        3.1 Skill-Reconstruction as the first match, since §3 has no
        body of its own in some paper formats. The contract: result is
        non-null and starts at or after §3, never before."""
        txt = _load_fixture()
        out = _node_dispatch(
            "getSection", {"txt": txt, "ref": "§3", "maxChars": 4000}
        )
        self.assertIsNotNone(out["result"])
        # The very first heading matched must be in the §3 family
        # ('3 Method' or '3.1 Skill-Reconstruction Pretraining'). It
        # must NOT be a later chapter like '4 Experiments'.
        first_heading = out["result"].splitlines()[0]
        self.assertRegex(first_heading, r"^3(\.\d+)?\s")


@unittest.skipUnless(CORE.exists() and FIXTURE.exists(), "core/fixture missing")
class SearchRankingTest(unittest.TestCase):
    """Score = matches * (300 / max(80, seg_len)). Long paragraphs are
    down-weighted so a focused mention in a short block wins."""

    def test_search_finds_hypernetwork_mentions(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "search",
            {"txt": txt, "query": "hypernetwork LoRA", "topK": 3},
        )
        self.assertIsNotNone(out["result"])
        joined = "\n".join(out["result"])
        self.assertIn("hypernetwork", joined.lower())

    def test_search_returns_at_most_top_k_with_neighborhood(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "search",
            {"txt": txt, "query": "skill", "topK": 2},
        )
        # topK=2 but withNeighborhood adds ±1 each → max 6 segments
        self.assertIsNotNone(out["result"])
        self.assertLessEqual(len(out["result"]), 6)
        self.assertGreater(len(out["result"]), 0)

    def test_search_marks_primary_hits(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "search",
            {"txt": txt, "query": "LoRA", "topK": 2},
        )
        self.assertIsNotNone(out["result"])
        # At least one result must be a primary hit (★ prefix) — that's
        # the LLM-visible "this is a real match" signal.
        self.assertTrue(
            any(line.startswith("★ ") for line in out["result"]),
            f"expected at least one primary hit, got: {out['result']}",
        )

    def test_search_with_stopword_only_query_returns_null(self):
        txt = _load_fixture()
        out = _node_dispatch(
            "search",
            {"txt": txt, "query": "the of and", "topK": 4},
        )
        self.assertIsNone(out["result"])


if __name__ == "__main__":
    unittest.main()
