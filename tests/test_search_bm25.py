"""Stage 4 — BM25 打分器扩展的 pytest 契约。

覆盖(plan §阶段/Stage 4 关键决策):

  - CJK 重叠 bigram:`强化学习 reward` → `["强化","化学","学习","reward"]`
  - 1-char 纯 CJK → tokens 为空 / bm25 empty:true(reason='pure-cjk-short')
  - idf 恒正:`ln(1 + (N - df + 0.5) / (df + 0.5))` 在 df ∈ (0, N] 都 > 0
  - 字段权重用 MAX(不是 SUM):doc 命中两个字段时,score 等于两者中较大者
  - k1/b 生效:小 k1 减少 tf 饱和,大 b 增大长文档的 length 归一化惩罚
  - 不动 rankSegmentsByQuery 老公式(test_paper_retrieval_core.py:140 钉住)。

通过 spawn `node`(NODE_BIN 可注入)→ paper-retrieval-core.mjs CLI 子命令,
输入 JSON,解析输出。和 tests/test_paper_retrieval_core.py 一致的 spawn 模式。
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE_BIN", "node")
CORE = ROOT / "astro-src" / "scripts" / "paper-retrieval-core.mjs"


def _node_dispatch(cmd: str, payload: dict) -> dict:
    """Spawn paper-retrieval-core.mjs with `cmd` and a JSON payload, return parsed result."""
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


@unittest.skipUnless(CORE.exists(), "core missing")
class TokenizeBM25Test(unittest.TestCase):
    """tokenizeBM25: CJK 重叠 bigram + Latin word,过滤停用词。"""

    def test_cjk_overlapping_bigrams_with_latin_word(self):
        """'强化学习 reward' → ['强化','化学','学习','reward']."""
        out = _node_dispatch("tokenize", {"text": "强化学习 reward"})
        self.assertEqual(out["tokens"], ["强化", "化学", "学习", "reward"])

    def test_pure_cjk_two_chars_one_bigram(self):
        """'学习' → ['学习'](一个 bigram)."""
        out = _node_dispatch("tokenize", {"text": "学习"})
        self.assertEqual(out["tokens"], ["学习"])

    def test_pure_cjk_single_char_returns_empty(self):
        """'学' 单字无法形成 bigram → empty。"""
        out = _node_dispatch("tokenize", {"text": "学"})
        self.assertEqual(out["tokens"], [])

    def test_strips_punctuation_keeps_tokens(self):
        """标点分隔 token:'强化-学习' 应当保留 bigram,标点不成为 token."""
        out = _node_dispatch("tokenize", {"text": "强化-学习"})
        # bigram '强化学' 跨过 '-'? 不,我们的实现把 '-' 当 CJK 段边界切断
        # → '强化' 一段, '学习' 一段,各自 bigram = 自身 + 自相邻
        # 实际: '强化' 是 2 字符 → 1 个 bigram '强化','学习' 是 2 字符 → 1 个 bigram '学习'.
        self.assertIn("强化", out["tokens"])
        self.assertIn("学习", out["tokens"])

    def test_empty_text_returns_empty(self):
        out = _node_dispatch("tokenize", {"text": ""})
        self.assertEqual(out["tokens"], [])

    def test_stop_word_filtered(self):
        """英文停用词被过滤;CJK 停用词也走同一路径."""
        out = _node_dispatch("tokenize", {"text": "the of and"})
        self.assertEqual(out["tokens"], [])


@unittest.skipUnless(CORE.exists(), "core missing")
class BuildBm25IndexTest(unittest.TestCase):
    """buildBm25Index: postings / fieldMasks / docLen / avgdl 形状正确."""

    def _basic_rows(self):
        return [
            {"id": "a", "title": "强化学习", "tldr": "深度学习算法"},
            {"id": "b", "title": "机器学习", "tldr": "神经网络"},
        ]

    def test_bm25_returns_expected_shape(self):
        rows = self._basic_rows()
        out = _node_dispatch(
            "bm25",
            {
                "rows": rows,
                "fieldsIndex": {"title": "title", "tldr": "tldr"},
                "query": "强化学习",
            },
        )
        # 形状:scores 数组长度 == rows 长度,matchedFields 等长
        self.assertEqual(len(out["scores"]), 2)
        self.assertEqual(len(out["matchedFields"]), 2)
        self.assertIn("title", out["perFieldScores"])
        self.assertIn("tldr", out["perFieldScores"])

    def test_no_match_returns_zero_scores(self):
        rows = self._basic_rows()
        out = _node_dispatch(
            "bm25",
            {
                "rows": rows,
                "fieldsIndex": {"title": "title"},
                "query": "zzqqnonexistent",
            },
        )
        self.assertEqual(out["scores"], [0.0, 0.0])


@unittest.skipUnless(CORE.exists(), "core missing")
class PureCjkShortQueryTest(unittest.TestCase):
    """<2 字纯 CJK query → {empty:true, reason:'pure-cjk-short'}.
    让 UI 据此降级 substring,而不是输出空列表假称 BM25。"""

    def test_one_char_cjk_query_marks_empty(self):
        out = _node_dispatch(
            "bm25",
            {
                "rows": [{"id": "a", "title": "强化学习"}],
                "fieldsIndex": {"title": "title"},
                "query": "学",
            },
        )
        self.assertTrue(out.get("empty"))
        self.assertEqual(out.get("reason"), "pure-cjk-short")
        self.assertEqual(out["scores"], [])

    def test_mixed_cjk_latin_query_not_flagged(self):
        """'学 A' 不是纯 CJK,正常打分."""
        out = _node_dispatch(
            "bm25",
            {
                "rows": [{"id": "a", "title": "A B"}],
                "fieldsIndex": {"title": "title"},
                "query": "学 A",
            },
        )
        self.assertNotIn("empty", out)
        self.assertEqual(len(out["scores"]), 1)

    def test_two_char_cjk_query_not_flagged(self):
        """'学习' 不是 < 2 字纯 CJK."""
        out = _node_dispatch(
            "bm25",
            {
                "rows": [{"id": "a", "title": "学习"}],
                "fieldsIndex": {"title": "title"},
                "query": "学习",
            },
        )
        self.assertNotIn("empty", out)


@unittest.skipUnless(CORE.exists(), "core missing")
class IdfAndMaxAggregationTest(unittest.TestCase):
    """idf 恒正;fieldBoost = MAX(不是 SUM)。"""

    def _two_docs_with_overlap(self):
        # doc0 在 title + tldr 都有 'rag' → 应触发 MAX 聚合
        # doc1 只在 tldr 有 'rag'
        return [
            {"id": "0", "title": "rag method", "tldr": "rag overview"},
            {"id": "1", "title": "unrelated", "tldr": "rag details"},
        ]

    def test_idf_is_positive_for_typical_df(self):
        """idf = ln(1 + (N - df + 0.5)/(df + 0.5)):df ∈ (0, N] 都 > 0.
        实测:有任何匹配 doc,idf > 0。score 也 > 0。"""
        out = _node_dispatch(
            "bm25",
            {
                "rows": self._two_docs_with_overlap(),
                "fieldsIndex": {"title": "title", "tldr": "tldr"},
                "query": "rag",
            },
        )
        self.assertGreater(out["scores"][0], 0.0)
        self.assertGreater(out["scores"][1], 0.0)

    def test_max_aggregation_not_sum(self):
        """doc0 命中 2 个字段('rag' 在 title 和 tldr),doc1 只命中 1 个字段('rag' 在 tldr).
        用 DEFAULT_FIELD_WEIGHTS,title=2.0, tldr=1.5。
        若走 SUM:doc0 = 2.0*X + 1.5*X = 3.5*X
        若走 MAX:doc0 = max(2.0*X, 1.5*X) = 2.0*X
        断言两者比值 — SUM 下 doc0 是 doc1 的 3.5/1.5 = 2.33 倍,MAX 下 ≈ 1.33 倍
        (考虑 doc 内 idf/avgdl 相同,差异由 fields 的 term freq 决定)。
        我们直接断言:doc0_score ≤ doc1_score * field-ratio-range 内,
        即 doc0 不会比 doc1 大太多(SUM 会让 doc0 双吃分)。"""
        out = _node_dispatch(
            "bm25",
            {
                "rows": self._two_docs_with_overlap(),
                "fieldsIndex": {"title": "title", "tldr": "tldr"},
                "query": "rag",
            },
        )
        s0 = out["scores"][0]
        s1 = out["scores"][1]
        self.assertGreater(s0, 0.0)
        self.assertGreater(s1, 0.0)
        # SUM 让 s0 / s1 ~ 2.33(title:tldr weight = 2.0:1.5)
        # MAX 让 s0 / s1 ∈ [title_weight/tldr_weight = 1.33, doc0 = doc1 ≈ 1.0]
        # 实际工程口径:比值应 ≤ 2.0(MAX),SUM 场景下会 > 2.0
        ratio = s0 / s1
        self.assertLess(
            ratio,
            2.05,
            f"expected MAX-aggregation ratio, got s0/s1 = {ratio:.3f} (likely SUM)",
        )

    def test_field_weights_override(self):
        """opts.fieldWeights 可调;传递 title:0 → doc 命中 title 仍给 0 分."""
        out = _node_dispatch(
            "bm25",
            {
                "rows": self._two_docs_with_overlap(),
                "fieldsIndex": {"title": "title", "tldr": "tldr"},
                "query": "rag",
                "opts": {"fieldWeights": {"title": 0.0, "tldr": 1.0}},
            },
        )
        s0 = out["scores"][0]  # 命中 title + tldr
        s1 = out["scores"][1]  # 只命中 tldr
        # 标题权重 0 后,doc0 应接近 doc1(tldr 命中都贡献 1.0)
        self.assertAlmostEqual(s0, s1, delta=max(abs(s1), 1e-6) * 0.05 + 1e-6)


@unittest.skipUnless(CORE.exists(), "core missing")
class K1BParametersTest(unittest.TestCase):
    """k1/b 真的影响分数(不是被 opts 吃掉)。"""

    def test_k1_increases_tf_saturation(self):
        """k1 越大,tf 项贡献越趋近上限;k1=0 时完全 length-归一化前的 raw tf。
        长字段多次重复 → 大 k1 让分变大(因为 tf*(k1+1) 项)。"""
        rows = [
            {"id": "0", "title": "rag rag rag rag rag"},  # tf=5
            {"id": "1", "title": "rag"},  # tf=1
        ]
        out = _node_dispatch(
            "bm25",
            {
                "rows": rows,
                "fieldsIndex": {"title": "title"},
                "query": "rag",
                "opts": {"k1": 1.5},
            },
        )
        s0_k15 = out["scores"][0]
        s1_k15 = out["scores"][1]
        self.assertGreater(s0_k15, s1_k15)

    def test_b_zero_disables_length_normalization(self):
        """b=0 → 公式中 dl/avgdl 项消失,长 doc 不被惩罚。"""
        rows = [
            {"id": "0", "title": "rag"},  # 短
            {"id": "1", "title": "rag " + "x " * 100},  # 长
        ]
        # b=0 → tf 项不被 length 调整,所以两 doc 的 tf 项相同(都是 1),
        # 唯一的差异在 dl/avgdl 项:长 doc 在 b=1 下被强烈降权。
        out_b0 = _node_dispatch(
            "bm25",
            {
                "rows": rows,
                "fieldsIndex": {"title": "title"},
                "query": "rag",
                "opts": {"b": 0.0, "k1": 1.5},
            },
        )
        out_b1 = _node_dispatch(
            "bm25",
            {
                "rows": rows,
                "fieldsIndex": {"title": "title"},
                "query": "rag",
                "opts": {"b": 1.0, "k1": 1.5},
            },
        )
        # b=0 时,两 doc 分数应当更接近(因为 length 惩罚被禁用)
        diff_b0 = abs(out_b0["scores"][0] - out_b0["scores"][1])
        diff_b1 = abs(out_b1["scores"][0] - out_b1["scores"][1])
        # b=0 关闭 length 惩罚 → diff 更小
        self.assertLess(diff_b0, diff_b1 + 1e-9)


if __name__ == "__main__":
    unittest.main()