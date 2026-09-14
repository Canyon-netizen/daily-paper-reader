# Library Inclusion Standard — Multi-Dimensional Rubric

> **Purpose:** Make `library-ingest` match the reader's level, not just the topic. A
> first-year PhD reading 5 papers/week has different "in scope" than a senior reviewer
> evaluating 50/week. We collapse that into 4 **audience profiles**, each with its own
> relevance rubric + threshold.
>
> **Authority:** This doc is the source of truth for `astro-src/lib/library/audience-profiles.ts`.
> If the code disagrees, treat the code as a bug.
>
> **Created:** 2026-09-14 (iter of the PhD-journey reshape)

---

## 1. Why split by persona, not just topic?

The existing `LibraryDefinition.relevanceThreshold` answers **how strict** but not
**what counts as relevant**. Two readers can use the same threshold and disagree:

| Reader | "This is the right paper" can mean… | Penalize harshly… |
|---|---|---|
| 1st-year PhD | Foundational, well-cited, sets up vocabulary | Jargon-heavy, requires domain knowledge |
| Domain expert | Advances SoTA, novel mechanism | Rehash of known result |
| Reviewer (peer) | Methodologically sound, replicable, claims calibrated | Unsubstantiated claims, missing ablations |
| Industry practitioner | Reproducible on a single GPU, ships to product | Toy-scale, missing latency/cost discussion |

A **single rubric** makes the library feel wrong to ~3 of 4 personas. Splitting the rubric
keeps the *topic* (the library's `statement` + `keywords`) the same but changes the
**scoring axes**.

---

## 2. Four Audience Profiles

Each profile = `{ id, label, axes: Axis[], defaultThreshold, scopeHints }`.

### 2.1 `novice` — 入门小白 (1st-year PhD / 跨领域入门)

> **Profile:** New to the topic. Wants papers that *teach*, not papers that *push SoTA*.
> Would rather read 5 foundational papers well than 50 incremental ones.

| Axis | Weight | What 1 means | What 5 means |
|------|--------|--------------|--------------|
| **Pedagogical clarity** | 0.30 | Heavy jargon, no definitions, assumes prior work | Clearly motivates, defines terms, examples |
| **Foundational weight** | 0.25 | Marginal extension of known result | Highly cited, defines a paradigm or sets a baseline |
| **Replicability** | 0.20 | No code / opaque hyperparameters | Public code + small-scale reproducible |
| **Survey / tutorial value** | 0.15 | Single-method contribution | Useful as a teaching artifact or roadmap entry |
| **Cross-disciplinary accessibility** | 0.10 | Requires deep subfield background | Bridges to neighbouring fields |

- **Default threshold:** `0.55` (lenient — better to over-include and let user reject)
- **Scope hints (LLM prompt add-on):** "Prefer papers that introduce a concept or
  paradigm over papers that improve a benchmark by 0.5%. Penalize jargon density."
- **Anti-patterns:** Reject papers where `evidence` and `method` sections assume the
  reader already knows the prior 10 papers in the lineage.

### 2.2 `expert` — 深耕领域的专家 (3rd-year PhD+ / postdoc / senior researcher)

> **Profile:** Lives in this topic. Wants to know what's *new*, what's *sober*, and what
> changes how they think. Skims the rest.

| Axis | Weight | What 1 means | What 5 means |
|------|--------|--------------|--------------|
| **Novelty** | 0.30 | Rehash of prior work | Introduces a new mechanism / theory / result |
| **Empirical rigor** | 0.20 | Missing baselines, no ablations | Comprehensive baselines + ablations + statistical tests |
| **Theoretical depth** | 0.15 | Heuristic with no analysis | Provable bounds, identifiability, convergence |
| **Connection to open problems** | 0.15 | Solves toy / niche problem | Tackles a known hard problem head-on |
| **Replicability** | 0.10 | Closed-source, unclear hyperparams | Code + data + clear hyperparameters |
| **Writing precision** | 0.10 | Vague claims, hand-wavy | Precise claims, calibrated uncertainty |

- **Default threshold:** `0.75` (strict — only the genuinely interesting stuff)
- **Scope hints:** "Reward papers that change how I think about the problem. Penalize
  benchmark-chasing without insight."
- **Anti-patterns:** Reject papers where the only contribution is a new number on an
  established benchmark with no mechanistic explanation.

### 2.3 `reviewer` — 专业论文审稿人 (area chair / 资深审稿)

> **Profile:** Reading to evaluate. Will check claims, baselines, ablations, novelty vs
> prior work. Tolerance for imperfection if contribution is real.

| Axis | Weight | What 1 means | What 5 means |
|------|--------|--------------|--------------|
| **Methodological soundness** | 0.25 | Flawed experimental design or unsupported claim | Sound methodology, claims supported by evidence |
| **Novelty vs prior art** | 0.20 | Already shown elsewhere, missing citations | Clear positioning vs closest prior work |
| **Reproducibility** | 0.15 | No code, opaque setup | Code + hyperparameters + compute budget disclosed |
| **Calibration of claims** | 0.15 | Overclaiming ("solves X" without evidence) | Claims match evidence, uncertainty acknowledged |
| **Clarity of writing** | 0.10 | Ambiguous, hard to follow | Clear, well-structured, diagrams used well |
| **Ethical / safety review** | 0.10 | Ignores bias, safety, dual-use | Discusses limitations, ethical considerations |
| **Significance** | 0.05 | Trivial / niche | Materially advances the field |

- **Default threshold:** `0.65` (medium — read more, reject more on review)
- **Scope hints:** "Read as if reviewing for a top venue. Flag missing baselines,
  missing ablations, overclaiming. Reward papers that hold up to scrutiny."
- **Anti-patterns:** Reject papers where the only novelty is engineering effort and
  no new insight.

### 2.4 `practitioner` — 工业界实践者 (research engineer / applied scientist)

> **Profile:** Wants to know "can I use this, how much does it cost, does it ship?"
> Cares about latency, training cost, integration complexity.

| Axis | Weight | What 1 means | What 5 means |
|------|--------|--------------|--------------|
| **Production readiness** | 0.25 | Toy / academic-only | Can be deployed with reasonable engineering |
| **Cost / efficiency** | 0.20 | 1000-GPU training, $1M+ | Single-GPU / single-node reproducible |
| **Latency / throughput** | 0.15 | Not measured or impractical | Reported numbers, competitive with SoTA |
| **Integration complexity** | 0.15 | Requires bespoke infra | Standard stack (PyTorch + HuggingFace etc.) |
| **Robustness** | 0.15 | Brittle to distribution shift | Tested on out-of-distribution + edge cases |
| **Open-source quality** | 0.10 | Code dump, no docs | Clean repo, tests, examples, CI |

- **Default threshold:** `0.60` (medium — err on side of "might be useful")
- **Scope hints:** "Filter for what I can actually deploy. Penalize work that only
  works at OpenAI-scale. Reward clean code and honest cost numbers."
- **Anti-patterns:** Reject papers that hand-wave compute requirements.

---

## 3. How a profile changes ingest behavior

`astro-src/scripts/library-ingest.ts` and `astro-src/lib/library/relevance.ts` are the
two places that consume the profile. The contract:

```ts
interface LibraryAudienceProfile {
  id: 'novice' | 'expert' | 'reviewer' | 'practitioner';
  label: string;                // for UI display
  defaultThreshold: number;     // 0-1
  axes: { name: string; weight: number; description: string }[];
  scopeHints: string;           // LLM prompt addendum
  antiPatterns: string[];       // human-readable rejection hints
}
```

When `LibraryDefinition.audienceProfile` is set:

1. **Threshold** defaults to `profile.defaultThreshold` if user didn't set it explicitly.
2. **Prompt augmentation**: `scorePaperRelevance` injects `scopeHints` into the
   system prompt, telling the LLM to evaluate along `axes`.
3. **Output schema extension**: `RelevanceScore` gains an optional `axes` object:
   ```ts
   { score: 0-1, reason: string, tldr: string, axes?: Record<string, 1-5> }
   ```
   UI surfaces this as a radar chart on the candidate review panel.

If the profile is **not set**, behavior is unchanged (legacy single-threshold scoring).

---

## 4. Field on `LibraryDefinition`

Add to `astro-src/lib/user-libraries/types.ts:LibraryDefinition`:

```ts
audienceProfile?: 'novice' | 'expert' | 'reviewer' | 'practitioner';
```

Backwards-compatible: existing libraries without this field fall back to the legacy
behavior (single threshold, no axes). Migration is a no-op.

UI: `NewLibraryModal.astro` adds a "读者画像" picker at step 2 (after name, before
statement), with 4 cards explaining each profile in one sentence + the default
threshold shown next to it.

---

## 5. Validation: how to know the rubric is working

Three signals to track in `docs/feedback/library-inclusion-log.md`:

1. **Adoption**: % of user libraries with `audienceProfile` set after 30 days.
   Target: ≥60%.
2. **Precision proxy**: among papers the user manually marks as `included` after
   `candidate` status, what's the average LLM-given `score` per profile?
   - `novice` should land higher on pedagogical clarity (subset of axes)
   - `expert` should land higher on novelty
   - `practitioner` should land higher on cost/efficiency
3. **User feedback**: open the rate (open / total seen) for the "📝 标记这篇不符合
   本库" feedback button per profile.

If a profile's adoption is <10% after 30 days, either the UI is too hidden or the
profile isn't useful — flag for review.

---

## 6. Related documents

- [`docs/library-architecture.md`](../library-architecture.md) — storage + lifecycle
- [`docs/path-spec.md` §8](../path-spec.md) — `relevanceThreshold` field
- [`docs/onboarding/phd-journey.md`](../onboarding/phd-journey.md) — which profile
  to pick at which career stage
- `astro-src/lib/library/audience-profiles.ts` — code mirror of this document
