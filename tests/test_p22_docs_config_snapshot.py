"""Regression tests for P2-2: docs/config.yaml commit gap.

The daily workflow (`.github/workflows/daily-paper-reader.yml`) ends main
with `cp -f config.yaml docs/config.yaml` so the static site can serve a
read-only snapshot without GitHub Token. The "Commit results" step adds
`paths=(docs config.yaml)`, where the `docs` argument expands to everything
under `docs/`. This test pins that contract:

- `git add docs` MUST stage `docs/config.yaml` when it differs from HEAD.
- The workflow YAML MUST contain the `cp -f config.yaml docs/config.yaml` step.

If either invariant breaks (e.g. someone narrows the commit step to a
specific subpath and forgets the snapshot), the static site will silently
serve a stale `docs/config.yaml` while `config.yaml` advances — a confusing
state for downstream Gist / settings consumers.
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

    def test_daily_workflow_commit_step_adds_docs(self):
        """`git add docs` is what causes docs/config.yaml to be staged — pin it."""
        workflow = (ROOT / ".github" / "workflows" / "daily-paper-reader.yml").read_text(encoding="utf-8")
        # The commit step uses `paths=(docs config.yaml)` then `git add "${paths[@]}"`.
        self.assertIn('paths=(docs config.yaml)', workflow)
        self.assertIn('git add "${paths[@]}"', workflow)


if __name__ == "__main__":
    unittest.main()