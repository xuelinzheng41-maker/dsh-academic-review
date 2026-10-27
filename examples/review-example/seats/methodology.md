# Review card - R1 (Peer Reviewer 1 - Methodology)

- Review: rev-20261027-9e9ab217
- Seat: methodology (role marker R1)
- Verdict: major_revision
- Confidence: 0.82
- Created: 2026-10-27T09:44:00+00:00
- Committed: 2026-10-27T11:26:14+08:00

## Summary

Methodology seat (R1). The experimental design cannot support the reported effect sizes. Each of the three headline deltas rests on a single random seed with no repetition, confidence interval, or significance test; the two hyperparameters that govern the method's behaviour (impurity threshold, data-dependent radius cap) are never given values; and the baseline set omits every modern competitor. The iterative refinement is stopped by an arbitrary constant. As it stands the numbers are point observations, not measurements.

## Findings

### methodology-F1 - Single-seed evaluation with no variance estimate; reported gains are not distinguishable from seed noise [critical]

All three reported improvements (3.1, 2.6, 2.6 points) come from one run per dataset. No standard deviation, confidence interval, or paired test is reported, and the number of seeds is stated as one. On datasets of this kind, seed-to-seed variation in k-NN accuracy is routinely of the same order as the reported deltas, so the central quantitative claim is unsupported until the authors report at least 5-10 seeds per configuration with means, standard deviations, and paired significance tests against each baseline.

Evidence:

- at Section 4 Experiments: USPS-rot, and from 70.0 to 72.6 on the sensor set. Each result uses a single

### methodology-F2 - Fixed iteration budget of 10 is an unjustified stopping constant with no convergence or sensitivity analysis [major]

The refinement loop terminates after a hard-coded ten iterations regardless of dataset, scale, or whether the split/merge process has converged. No convergence plot, no sensitivity sweep over the budget, and no criterion for choosing 10 are given, so the reader cannot tell whether the reported accuracy is at, before, or past the method's optimum. Report the effect of the budget on accuracy and ball count, and justify or replace the constant with a convergence criterion.

Evidence:

- at Section 3 Method: The stopping rule uses a fixed iteration budget of 10.

### methodology-F3 - Baseline set is too weak to isolate the claimed mechanism [major]

Only k-NN and a fixed-radius granular-ball baseline are compared. There is no noise-aware or robust-classification baseline, no prototype/data-reduction baseline matched for the same compression ratio, and no ablation separating the effect of radius adaptation from the effect of simply reducing the training set. Without a compression-matched control the authors cannot attribute the gain to adaptivity rather than to fewer, cleaner training points.

Evidence:

- at Section 4 Experiments: The baselines are k-NN and a fixed-radius granular-ball baseline.

### methodology-F4 - Core hyperparameters and the noise estimator are never specified [minor]

The radius is defined as a maximum distance 'capped at a data-dependent maximum', and splitting depends on an impurity threshold, but neither the cap rule, the threshold value, nor how the local noise estimate is computed is ever stated. The method as written is not reimplementable: give explicit formulas, chosen values, and the procedure for estimating local noise.

Evidence:

- at Section 3 Method: We define the granular ball radius as the maximum distance from the centroid to

## Provenance

- peer_output_visible: false (role separation is not independence)
- model: cn:deepseek-v4.1-flash
- context_fresh: true
- human_operator: qa-verifier

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
