"""Parametrized smoke test for the 8 refactored init_*.py scripts.

Before PR-3 each per-source init script had its own 30-line test file
(`tests/test_init_supabase_from_<source>.py`) that only asserted
`TODAY_STR` matches `^\\d{8}$`. After PR-3 collapses the boilerplate into
`src.maintain.init_factory`, this single file checks the same property for
all 8 sources with one test method. `tests/test_init_supabase_from_biorxiv.py`
is kept (it covers non-trivial resolve_date_token behavior that no other
source needs to repeat).
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


SOURCES = [
    "init_aaai",
    "init_acl",
    "init_chemrxiv",
    "init_emnlp",
    "init_iclr",
    "init_icml",
    "init_medrxiv",
    "init_neurips",
]


def _load(module_name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class InitScriptsParametrizedTest(unittest.TestCase):
    """Each init script must export TODAY_STR matching ^\\d{8}$."""

    def test_today_str_format(self) -> None:
        for source in SOURCES:
            with self.subTest(source=source):
                mod_path = SRC_DIR / "maintain" / f"{source}.py"
                mod = _load(f"{source}_mod", mod_path)
                self.assertRegex(
                    mod.TODAY_STR,
                    r"^\d{8}$",
                    f"{source}.py TODAY_STR must look like YYYYMMDD",
                )

    def test_init_factory_symbols_present(self) -> None:
        """init_factory must export the symbols every per-source script imports."""
        import src.maintain.init_factory as factory  # noqa: WPS433
        for name in (
            "add_embed_args",
            "build_sync_cmd",
            "resolve_embed_device",
            "resolve_raw_path",
            "run_step",
            "python_executable",
        ):
            self.assertTrue(
                hasattr(factory, name),
                f"init_factory must export {name!r}",
            )


if __name__ == "__main__":
    unittest.main()