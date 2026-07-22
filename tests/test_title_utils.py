import sys
import unittest
from pathlib import Path

# 把 src/ 加入路径以导入 title_utils
root = Path(__file__).resolve().parents[1]
src_dir = root / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from title_utils import strip_title_markup


class TitleUtilsTest(unittest.TestCase):
    def test_plain_title_unchanged(self):
        """普通英文/中文标题应保持不变"""
        self.assertEqual(
            strip_title_markup("Deep Learning for NLP"),
            "Deep Learning for NLP",
        )
        self.assertEqual(
            strip_title_markup("深度学习在自然语言处理中的应用"),
            "深度学习在自然语言处理中的应用",
        )

    def test_strip_inline_math_single_dollar(self):
        """剥掉 $...$ 行内数学标记"""
        self.assertEqual(
            strip_title_markup("Theoretical Foundations of $\\max$@$k$ Reinforcement Learning"),
            "Theoretical Foundations of max@k Reinforcement Learning",
        )
        self.assertEqual(
            strip_title_markup("$L^2$ regularization"),
            "L2 regularization",
        )

    def test_strip_display_math_double_dollar(self):
        """剥掉 $$...$$ 行间数学标记"""
        self.assertEqual(
            strip_title_markup("Optimization via $$E=mc^2$$ Principle"),
            "Optimization via E=mc2 Principle",
        )

    def test_strip_latex_commands(self):
        """剥掉常见 LaTeX 命令"""
        self.assertEqual(strip_title_markup(r"$\alpha$ attention"), "alpha attention")
        self.assertEqual(strip_title_markup(r"$\beta$-VAE"), "beta-VAE")
        self.assertEqual(strip_title_markup(r"$\gamma$ factor"), "gamma factor")
        self.assertEqual(strip_title_markup(r"$\mathrm{max}$ pooling"), "max pooling")
        self.assertEqual(strip_title_markup(r"$\mathbb{R}^n$ space"), "Rn space")

    def test_strip_subscripts_superscripts(self):
        """剥掉上下标符号"""
        self.assertEqual(strip_title_markup("$x_i$ embedding"), "xi embedding")
        self.assertEqual(strip_title_markup("$y^2$ loss"), "y2 loss")

    def test_strip_braces(self):
        """剥掉花括号、上下标符号(纯文本标签里没有用)"""
        # 花括号被默认剥掉;字母命令保留可读名字
        self.assertEqual(strip_title_markup("${alpha, beta}$ set"), "alpha, beta set")

    def test_max_at_k_paper(self):
        """针对目标论文 2607.17823v1 的标题测试"""
        raw_en = "Theoretical Foundations of $\\max$@$k$ Reinforcement Learning"
        raw_zh = "$\\max$@$k$ 强化学习的理论基础"
        self.assertEqual(
            strip_title_markup(raw_en),
            "Theoretical Foundations of max@k Reinforcement Learning",
        )
        self.assertEqual(
            strip_title_markup(raw_zh),
            "max@k 强化学习的理论基础",
        )

    def test_empty_and_none(self):
        """空值处理"""
        self.assertEqual(strip_title_markup(""), "")
        self.assertEqual(strip_title_markup(None), "")


if __name__ == "__main__":
    unittest.main()
