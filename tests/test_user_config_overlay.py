#!/usr/bin/env python
"""Tests for the `config.user.yaml` deep-merge overlay wired up
in PR #7 (code-layer follow-up).

The behaviour under test is documented in
[`config.user.yaml.example`](../config.user.yaml.example) and
README's 🍴 fork 配置工作流 section. These tests pin down:

1. `user_config_path()` resolves next to the base config by
   default; `DPR_USER_CONFIG` env override wins absolutely.
2. `_deep_merge()` is field-level for dicts, list wholesale for
   lists — never silently drops a profile in
   `subscriptions.intent_profiles`.
3. `load_config_with_source_migration()` applies the user
   overlay BEFORE the source_config migration, never writes to
   `config.user.yaml`, and the overlay can fully seed the dict
   when the base config.yaml is missing.

Tests do NOT touch the real on-disk `config.yaml`; everything is
sandboxed in a temp directory built by `tmp_path` (pytest
fixture).
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from src.source_config import (
    _deep_merge,
    _load_yaml_dict,
    load_config_with_source_migration,
    user_config_path,
)


def _write_yaml(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(payload, f, allow_unicode=True, sort_keys=False)


def test_user_config_path_default_next_to_base(tmp_path: Path, monkeypatch) -> None:
    """Default path resolution appends `.user.yaml` stem-side."""
    monkeypatch.delenv("DPR_USER_CONFIG", raising=False)
    base = tmp_path / "config.yaml"
    assert user_config_path(str(base)).endswith(".user.yaml")
    assert Path(user_config_path(str(base))).parent == tmp_path


def test_user_config_path_env_override_absolute(monkeypatch) -> None:
    monkeypatch.setenv("DPR_USER_CONFIG", "/tmp/dpr/my.yaml")
    assert user_config_path("/anywhere/config.yaml") == "/tmp/dpr/my.yaml"


def test_user_config_path_handles_yml_stem() -> None:
    """Pure-`.yml` extensions get the user suffix too."""
    assert user_config_path("/x/config.yml").endswith(".user.yml")


def test_deep_merge_dictionaries_recursively() -> None:
    """Dict-on-dict entries merge field-by-field; override wins at
    leaf level. Lists REPLACE wholesale — documented in
    `_deep_merge` docstring; deep-merging list elements would
    be ambiguous (positional vs identity)."""
    base = {
        "subscriptions": {
            "intent_profiles": [
                {"tag": "RL", "paper_sources": ["arxiv"], "enabled": True},
                {"tag": "MAS", "paper_sources": ["arxiv"], "enabled": True},
            ],
            "schema_migration": {"stage": "A"},
        },
        "arxiv_paper_setting": {"days_window": 9},
    }
    override = {
        "subscriptions": {
            "intent_profiles": [
                {"tag": "RL", "paper_sources": ["arxiv", "biorxiv"], "enabled": True},
            ],
            "schema_migration": {"stage": "B"},
        },
    }
    out = _deep_merge(base, override)
    # override list replaced wholesale (length 1, not 2)
    assert len(out["subscriptions"]["intent_profiles"]) == 1
    assert out["subscriptions"]["intent_profiles"][0]["paper_sources"] == [
        "arxiv",
        "biorxiv",
    ]
    assert out["subscriptions"]["intent_profiles"][0]["enabled"] is True
    # sibling dict still field-merged
    assert out["subscriptions"]["schema_migration"]["stage"] == "B"
    # unrelated key untouched
    assert out["arxiv_paper_setting"]["days_window"] == 9


def test_deep_merge_lists_replaced_wholesale() -> None:
    """Lists aren't deep-merged (that would be ambiguous); the
    override's list replaces the base list entirely."""
    base = {"tags": ["rl", "mas", "game-ai"]}
    override = {"tags": ["my-custom-tag"]}
    out = _deep_merge(base, override)
    assert out["tags"] == ["my-custom-tag"]


def test_load_yaml_dict_missing_file_returns_empty(tmp_path: Path) -> None:
    assert _load_yaml_dict(str(tmp_path / "nope.yaml")) == {}


def test_load_config_overlay_only_seeds_missing_base(tmp_path: Path, monkeypatch) -> None:
    """If the repo's config.yaml is empty (or missing), an
    overlay can still bootstrap the whole config."""
    monkeypatch.setenv("DPR_USER_CONFIG", str(tmp_path / "config.user.yaml"))
    base = tmp_path / "config.yaml"
    # base is empty/missing; user provides everything
    _write_yaml(
        tmp_path / "config.user.yaml",
        {
            "subscriptions": {
                "intent_profiles": [
                    {"tag": "RL", "paper_sources": ["arxiv"], "enabled": True},
                ],
            },
            "arxiv_paper_setting": {"days_window": 14},
        },
    )
    out = load_config_with_source_migration(str(base), write_back=False)
    assert out["arxiv_paper_setting"]["days_window"] == 14
    assert out["subscriptions"]["intent_profiles"][0]["tag"] == "RL"


def test_load_config_overlay_wins_over_base_key(tmp_path: Path, monkeypatch) -> None:
    """A single field override in user.yaml should win over the
    matching base key — without losing other base keys."""
    base_path = tmp_path / "config.yaml"
    user_path = tmp_path / "config.user.yaml"
    _write_yaml(
        base_path,
        {
            "github": {"owner": "upstream", "repo": "daily-paper-reader"},
            "arxiv_paper_setting": {"days_window": 9, "docs_dir": "docs"},
        },
    )
    _write_yaml(user_path, {"github": {"owner": "my-fork"}})
    monkeypatch.setenv("DPR_USER_CONFIG", str(user_path))
    out = load_config_with_source_migration(str(base_path), write_back=False)
    assert out["github"]["owner"] == "my-fork"
    # sibling field untouched
    assert out["github"]["repo"] == "daily-paper-reader"
    # sibling key untouched
    assert out["arxiv_paper_setting"]["days_window"] == 9
    assert out["arxiv_paper_setting"]["docs_dir"] == "docs"


def test_load_config_never_writes_user_yaml(tmp_path: Path, monkeypatch) -> None:
    """Even with `write_back=True`, only config.yaml is touched.
    A fork user's config.user.yaml must never be clobbered by
    the source-config migration step."""
    base_path = tmp_path / "config.yaml"
    user_path = tmp_path / "config.user.yaml"
    _write_yaml(
        base_path,
        {
            "supabase": {
                "enabled": True,
                "url": "https://upstream.supabase.co",
            },
        },
    )
    _write_yaml(
        user_path,
        {
            "subscriptions": {
                "intent_profiles": [
                    {"tag": "custom", "paper_sources": ["arxiv"], "enabled": True},
                ],
            },
        },
    )
    user_mtime_before = os.path.getmtime(user_path)
    monkeypatch.setenv("DPR_USER_CONFIG", str(user_path))
    load_config_with_source_migration(str(base_path), write_back=True)
    user_mtime_after = os.path.getmtime(user_path)
    # mtime unchanged proves we did not write to it
    assert user_mtime_after == user_mtime_before

    # but we did write to config.yaml (migration ran on merged)
    reloaded_base = _load_yaml_dict(str(base_path))
    assert "source_backends" in reloaded_base


def test_load_config_self_overlay_guard(tmp_path: Path, monkeypatch) -> None:
    """If someone points DPR_USER_CONFIG at the base config itself,
    we must not enter an infinite recursion (overlay = base)."""
    base = tmp_path / "config.yaml"
    _write_yaml(
        base,
        {"arxiv_paper_setting": {"days_window": 9}},
    )
    monkeypatch.setenv("DPR_USER_CONFIG", str(base))
    # Should NOT raise; should not read the file twice.
    out = load_config_with_source_migration(str(base), write_back=False)
    assert out["arxiv_paper_setting"]["days_window"] == 9
