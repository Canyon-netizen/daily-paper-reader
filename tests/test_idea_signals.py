from pathlib import Path
from src.idea_signals import *

def test_signals(tmp_path):
    (tmp_path/'a.md').write_text('published_at: 2026-07-01\nRAG agent\n## 局限性\nsmall sample')
    (tmp_path/'b.md').write_text('published_at: 2026-07-02\nagent benchmark')
    assert concept_holes(str(tmp_path), 8, 5)
    assert trend_concepts(str(tmp_path), 90, 5)
    assert limitation_excerpts(str(tmp_path))

def test_survey_mock():
    assert survey_gap(lambda q, window_days: [{'q':q,'days':window_days}])

def test_collect(tmp_path):
    out=collect_signals(str(tmp_path), {'arxiv_search':lambda q,window_days: []})
    assert set(out)=={'concept_holes','trends','limitations','survey_gap'}
