"""Regression tests for P2-2: docs/config.yaml commit + P3-2 split commits.

P2-2: The daily workflow ends main with `cp -f config.yaml docs/config.yaml`
so the static site can serve a read-only snapshot without GitHub Token.

P3-2 (new in this round): the workflow's "Commit results" step is split into
TWO commits instead of one:

  1. `[chore] daily config snapshot` — config.yaml + docs/config.yaml +
     archive state json files. Reflects fork user's localStorage settings
     overlay after daily pipeline applies it.

  2. `[chore] daily paper pipeline` — docs/papers/* metadata +
     archive/*/recommend.

Why split: git log distinguishes "config change" from "content update",
reviewing changes is easier, and rollback is more precise (revert content
without losing config).

This test pins both contracts:
- `git add docs` MUST stage `docs/config.yaml` when it differs from HEAD
  (P2-2 unchanged).
- The workflow YAML MUST contain both `cp -f config.yaml docs/config.yaml`
  (P2-2) and the two distinct commit messages "daily config snapshot" +
  "daily paper pipeline" (P3-2).

If either invariant breaks (e.g. someone merges the two commits back,
or narrows the commit step to a specific subpath and forgets the snapshot),
the static site will silently serve a stale `docs/config.yaml` while
`config.yaml` advances, or git history loses the snapshot/paper distinction.
"""

import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class GitAddDocsIncludesConfigSnapshotTest(unittest.TestCase):
    """Verify the git plumbing: when docs/config.yaml differs from HEAD,
    `git add docs` stages it."""

    def test_git_add_docs_includes_docs_config_yaml(self):
        # Use a throwaway sandbox so we don't pollute the real repo.
        with tempfile.TemporaryDirectory(prefix="dpr-p22-") as tmp:
            sandbox = pathlib.Path(tmp)

            def run(args, **kw):
                return subprocess.run(
                    args, cwd=str(sandbox), check=True,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw,
                )

            # Minimal one-commit repo with an initial docs/config.yaml
            run(["git", "init", "-q", "-b", "main"])
            run(["git", "config", "user.email", "test@example.com"])
            run(["git", "config", "user.name", "test"])
            run(["git", "config", "commit.gpgsign", "false"])
            (sandbox / "docs").mkdir()
            (sandbox / "docs" / "config.yaml").write_text("original: 1\n", encoding="utf-8")
            (sandbox / "docs" / "paper.md").write_text("# paper\n", encoding="utf-8")
            run(["git", "add", "docs/config.yaml", "docs/paper.md"])
            run(["git", "commit", "-q", "-m", "init"])

            # Mirror workflow: cp -f config.yaml docs/config.yaml after edit.
            (sandbox / "config.yaml").write_text("original: 1\n", encoding="utf-8")
            run(["git", "add", "config.yaml"])
            run(["git", "commit", "-q", "-m", "add config.yaml"])

            # Now mutate config.yaml + re-copy to docs/config.yaml (workflow step 200-203).
            (sandbox / "config.yaml").write_text("changed: 1\nmarker: P2-2-test\n", encoding="utf-8")
            run(["cp", "-f", "config.yaml", "docs/config.yaml"])

            # The exact workflow commit step: paths=(docs config.yaml) → git add docs config.yaml
            run(["git", "add", "docs"])
            run(["git", "add", "config.yaml"])

            staged = run(["git", "diff", "--cached", "--name-only"], text=True).stdout.splitlines()
            self.assertIn(
                "docs/config.yaml", staged,
                f"`git add docs` must stage docs/config.yaml when it differs from HEAD; got {staged}",
            )


class WorkflowHasConfigSnapshotStepTest(unittest.TestCase):
    """Verify the workflow YAML still contains the cp step that produces
    docs/config.yaml. If a refactor drops it, the static site loses the
    read-only config snapshot."""

    def test_daily_workflow_cp_step_present(self):
        workflow = (ROOT / ".github" / "workflows" / "daily-paper-reader.yml").read_text(encoding="utf-8")
        self.assertIn(
            "cp -f config.yaml docs/config.yaml",
            workflow,
            "daily workflow missing the cp -f config.yaml docs/config.yaml step",
        )

    def test_daily_workflow_uses_split_commit_messages(self):
        """P3-2: 'Commit results' step must emit two distinct commits so git
        log can distinguish config snapshot vs paper pipeline."""
        workflow = (ROOT / ".github" / "workflows" / "daily-paper-reader.yml").read_text(encoding="utf-8")
        # Both commit messages must exist in the YAML.
        self.assertIn(
            "[chore] daily config snapshot",
            workflow,
            "daily workflow missing the '[chore] daily config snapshot' commit message",
        )
        self.assertIn(
            "[chore] daily paper pipeline",
            workflow,
            "daily workflow missing the '[chore] daily paper pipeline' commit message",
        )
        # The old merged message must NOT be present (we want two commits, not one).
        self.assertNotIn(
            "[chore] daily pipeline\"",
            workflow,
            "daily workflow still emits a single '[chore] daily pipeline' commit — "
            "P3-2 split was reverted",
        )

    def test_daily_workflow_commit_step_paths_separated(self):
        """The two commits must stage disjoint path groups. We assert the
        `snapshot_paths` and `paper_paths` arrays exist and are separate."""
        workflow = (ROOT / ".github" / "workflows" / "daily-paper-reader.yml").read_text(encoding="utf-8")
        self.assertIn("snapshot_paths=", workflow)
        self.assertIn("paper_paths=", workflow)
        # `snapshot_paths` should mention config.yaml + archive state jsons.
        self.assertIn("docs/config.yaml", workflow.split("paper_paths=")[0])
        # `paper_paths` should mention archive/*/recommend.
        self.assertIn("recommend", workflow.split("snapshot_paths=")[1])


if __name__ == "__main__":
    unittest.main()