# Editorial Decision Letter

- Review: rev-20261027-9e9ab217 (full mode)
- Manuscript: D:\Deepseek\.t4-e2e-workspace\sample-paper.md
- Manuscript SHA-256: cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca
- Synthesized: 2026-10-27T11:26:22+08:00
- Advisory decision: major_revision

> Role separation notice: the seats produced their cards without seeing
> each other's output. Separated roles are not independent error processes,
> and this letter inherits that limit.

## 1. Seat verdicts

| Seat | Role | Verdict | Confidence | critical/major/minor/comment |
| --- | --- | --- | --- | --- |
| eic | EIC | major_revision | 0.72 | 0/2/1/0 |
| methodology | R1 | major_revision | 0.82 | 1/2/1/0 |
| domain | R2 | major_revision | 0.70 | 0/2/1/0 |
| perspective | R3 | minor_revision | 0.58 | 0/2/0/1 |
| da | DA | reject | 0.66 | 1/3/0/0 |

## 2. Consensus and disagreement

- Agreeing with the advisory decision: EIC (major_revision), R1 (major_revision), R2 (major_revision)
- Dissenting: R3 (minor_revision), DA (reject)

No finding title was raised by more than one seat.

## 3. Devil Advocate CRITICAL adjudication

- da-F1: validated - The manuscript states 'Each result uses a single random seed' and reports exactly one accuracy pair per dataset, while the introduction claims a 3.1-point average gain and the conclusion claims 'consistent gains'. With no repetitions, variance, confidence intervals, or significance tests, the reported deltas cannot be distinguished from seed noise or baseline tuning, so the central quantitative claim is genuinely unsupported as presented. The DA critical is upheld; it is consistent with the advisory major_revision and reinforces the methodology seat's methodology-F1.

## 4. Per-seat findings

### EIC - major_revision

- eic-F1 [major] Headline benchmark claim conflicts with the evaluation actually described
  - The introduction claims a 3.1-point average gain 'across three public benchmarks', but the experiments section names only two public benchmarks plus a private sensor set. Either the claim or the evaluation description is wrong, and in either case a numerate reader cannot reproduce the headline number from the paper. This must be reconciled and the private dataset's provenance, size, and licensing stated.
  - evidence at Section 1 Introduction: by 3.1 points on average across three public benchmarks.
  - evidence at Section 4 Experiments: We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor
- eic-F2 [major] Novelty claim is asserted, not established, and the contribution is thin for the target venue
  - The paper's entire novelty argument is one sentence dismissing all prior radius selection as global or per-dataset. No prior method is named, compared against, or cited for that claim, and the empirical section contains no adaptive-radius competitor. For JMLR the delta over existing granular-ball and noise-robust simplification work needs to be demonstrated, not asserted.
  - evidence at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either
- eic-F3 [minor] Manuscript is at draft-sketch length with no analysis section
  - There is no complexity or runtime analysis, no ablation of the mechanism's two components (splitting and merging), no figures, and no discussion section. The target venue expects a full article. I would not send this to referees in its present form, and the author should decide whether the contribution supports a full submission or a short note.
  - evidence at Title page: **Target venue:** Journal of Machine Learning Research (draft)

### R1 - major_revision

- methodology-F1 [critical] Single-seed evaluation with no variance estimate; reported gains are not distinguishable from seed noise
  - All three reported improvements (3.1, 2.6, 2.6 points) come from one run per dataset. No standard deviation, confidence interval, or paired test is reported, and the number of seeds is stated as one. On datasets of this kind, seed-to-seed variation in k-NN accuracy is routinely of the same order as the reported deltas, so the central quantitative claim is unsupported until the authors report at least 5-10 seeds per configuration with means, standard deviations, and paired significance tests against each baseline.
  - evidence at Section 4 Experiments: USPS-rot, and from 70.0 to 72.6 on the sensor set. Each result uses a single
- methodology-F2 [major] Fixed iteration budget of 10 is an unjustified stopping constant with no convergence or sensitivity analysis
  - The refinement loop terminates after a hard-coded ten iterations regardless of dataset, scale, or whether the split/merge process has converged. No convergence plot, no sensitivity sweep over the budget, and no criterion for choosing 10 are given, so the reader cannot tell whether the reported accuracy is at, before, or past the method's optimum. Report the effect of the budget on accuracy and ball count, and justify or replace the constant with a convergence criterion.
  - evidence at Section 3 Method: The stopping rule uses a fixed iteration budget of 10.
- methodology-F3 [major] Baseline set is too weak to isolate the claimed mechanism
  - Only k-NN and a fixed-radius granular-ball baseline are compared. There is no noise-aware or robust-classification baseline, no prototype/data-reduction baseline matched for the same compression ratio, and no ablation separating the effect of radius adaptation from the effect of simply reducing the training set. Without a compression-matched control the authors cannot attribute the gain to adaptivity rather than to fewer, cleaner training points.
  - evidence at Section 4 Experiments: The baselines are k-NN and a fixed-radius granular-ball baseline.
- methodology-F4 [minor] Core hyperparameters and the noise estimator are never specified
  - The radius is defined as a maximum distance 'capped at a data-dependent maximum', and splitting depends on an impurity threshold, but neither the cap rule, the threshold value, nor how the local noise estimate is computed is ever stated. The method as written is not reimplementable: give explicit formulas, chosen values, and the procedure for estimating local noise.
  - evidence at Section 3 Method: We define the granular ball radius as the maximum distance from the centroid to

### R2 - major_revision

- domain-F1 [major] Claim of a completely open gap is made without naming or citing any prior method that closes it partially
  - 'No prior work couples the radius to a local noise estimate' is a universal negative that needs either a cited survey or a systematic comparison. Granular computing, rough-set neighbourhood methods, and locally adaptive kernel/neighbourhood selection all contain closely adjacent ideas, and some of them tie scale to local density or label purity. Name the closest prior methods, state precisely how coupling to a *noise* estimate differs from coupling to density or impurity, and soften the claim if the distinction is narrower than stated.
  - evidence at Section 2 Related Work: Granular-ball computing extends rough-set theory to metric spaces. Prior
- domain-F2 [major] Reference list of two entries cannot support the positioning claims
  - Two references, both with the placeholder venue 'Journal of Examples', cannot establish coverage of granular-ball computing, rough-set theory, or noisy-label learning. Notably the fixed-radius granular-ball baseline used in the experiments is not cited at all, so the primary comparison point has no attributable source. Expand the bibliography to the actual foundational papers and cite the baseline implementation.
  - evidence at References: [1] Author et al. Granular-ball computing. Journal of Examples, 2020.
- domain-F3 [minor] The theoretical framing stops at one attributive sentence
  - The rough-set/granular-computing lineage is invoked but never used: no formal definition of a granular ball is given, no relationship between the proposed radius rule and existing granular-ball constructions is stated, and no property (consistency, coverage, or bounds on the ball count) is proved. Even a short formal section would let the community place the contribution relative to the existing theory it claims to extend.
  - evidence at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either

### R3 - minor_revision

- perspective-F1 [major] Deployment-facing costs that would decide practical adoption are not reported
  - For the sensor use case the paper motivates, the relevant questions are ball count versus accuracy, per-sample inference cost, memory footprint, and behaviour under distribution shift. None are measured. A short results table reporting compression ratio, training time, and inference time at matched accuracy would make the practical claim assessable and would also serve the methodological concern about whether the gain comes from fewer training points.
  - evidence at Section 4 Experiments: We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor
- perspective-F2 [major] Unstated assumption: a reliable local noise estimate is available before the method is applied
  - The entire mechanism is conditioned on a local noise estimate being high or low, but the paper never says how that estimate is obtained, nor whether it is available in the regime it targets. If labels are corrupted as claimed in the introduction, estimating noise from those same labels risks circularity. State the noise estimator, its data requirements, and what the method does when the estimate is itself unreliable.
  - evidence at Section 1 Introduction: exceeds a threshold. We claim AGBS improves downstream classification accuracy
- perspective-F3 [comment] Adjacent traditions that would strengthen the contribution are ignored
  - Prototype selection and instance reduction, active learning under label noise, and coreset construction all solve a closely related problem and offer both baselines and terminology. Connecting to them would sharpen the contribution claim, give reviewers familiar comparison points, and likely suggest cheap extra experiments. The private-set provenance also deserves an explicit privacy/data-governance sentence, since the paper's framing is a real deployment.
  - evidence at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either

### DA - reject

- da-F1 [critical] The headline 3.1-point gain is a single-run point estimate, so the paper's central claim is unfalsifiable as presented
  - The introduction's headline claim and the conclusion's 'consistent gains' both rest on one seed per configuration. With one observation per cell there is no error term: a delta of 2.6-3.1 points cannot be separated from seed variance, from baseline hyperparameter choice, or from the effect of reducing the training set. Everything downstream in the paper — the abstract claim, the 'consistent gains' conclusion, the generalization claim — is built on this single unsupported number. Minimum remedy: repeat every configuration over at least five seeds, report mean and standard deviation, and run paired tests against each baseline, with the compression ratio matched. If the effect survives that, most of my objection disappears.
  - evidence at Section 4 Experiments: USPS-rot, and from 70.0 to 72.6 on the sensor set. Each result uses a single
  - evidence at Section 1 Introduction: by 3.1 points on average across three public benchmarks.
- da-F2 [major] Overgeneralization: 'any metric space' is claimed from three tabular/image benchmarks with no supporting experiment
  - The conclusion generalizes beyond the evidence by orders of magnitude. Every experiment is a fixed-dimensional vector classification task; there is no test on a graph metric, a text embedding, a time-series metric, or a metric with non-Euclidean geometry, and the method's own definition assumes a centroid and a bounded maximum distance, which do not exist in arbitrary metric spaces. Either run the experiment that licenses the claim or restrict it to the tested setting.
  - evidence at Section 5 Conclusion: the approach generalizes to any metric space.
- da-F3 [major] Cherry-pickable benchmark construction: two rotation variants of handwriting data plus an unreleased private set
  - The evidence base is narrower than its three-dataset presentation implies. MNIST-rot and USPS-rot are the same augmentation applied to two handwriting collections, so the three results are not three independent tests of the mechanism, and the third cannot be inspected by any reader. There is no negative result, no dataset where the method fails, and no per-class or per-noise-level breakdown that would show where adaptivity helps. Add at least one dataset from a different domain and report failures honestly.
  - evidence at Section 4 Experiments: We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor
- da-F4 [major] Ignored alternative explanation: the gain may come from fewer training points, not from noise-adaptive radii
  - The paper never rules out the deflationary story. Shrinking radii where noise is high removes or downweights noisy members, which changes the effective training-set size and the decision-boundary smoothness; both effects are known to move k-NN accuracy by a few points on their own. Without a control that holds compression fixed while disabling the noise coupling, and without an ablation of the split and merge steps, the attributed cause is unestablished. The fixed iteration budget of 10 further means the comparison is against a baseline tuned differently.
  - evidence at Section 3 Method: The stopping rule uses a fixed iteration budget of 10.
  - evidence at Section 4 Experiments: The baselines are k-NN and a fixed-radius granular-ball baseline.

## 5. Decision

Advisory decision: major_revision.

Delivering this letter requires explicit human approval (human checkpoint 2,
docs/PORT_SPEC.md section 4.4). The plugin never approves its own output.

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
