# Revision Roadmap (advisory, non-ranking)

- Review: rev-20261027-9e9ab217
- Manuscript SHA-256: cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca
- Generated: 2026-10-27T11:26:22+08:00

Items are grouped by severity and listed in seat order. That order is not a
priority ranking and implies no schedule; the authors decide what to act on.

## critical (2)

- [R1] methodology-F1 - Single-seed evaluation with no variance estimate; reported gains are not distinguishable from seed noise (at Section 4 Experiments)
- [DA] da-F1 - The headline 3.1-point gain is a single-run point estimate, so the paper's central claim is unfalsifiable as presented (at Section 4 Experiments)

## major (11)

- [EIC] eic-F1 - Headline benchmark claim conflicts with the evaluation actually described (at Section 1 Introduction)
- [EIC] eic-F2 - Novelty claim is asserted, not established, and the contribution is thin for the target venue (at Section 2 Related Work)
- [R1] methodology-F2 - Fixed iteration budget of 10 is an unjustified stopping constant with no convergence or sensitivity analysis (at Section 3 Method)
- [R1] methodology-F3 - Baseline set is too weak to isolate the claimed mechanism (at Section 4 Experiments)
- [R2] domain-F1 - Claim of a completely open gap is made without naming or citing any prior method that closes it partially (at Section 2 Related Work)
- [R2] domain-F2 - Reference list of two entries cannot support the positioning claims (at References)
- [R3] perspective-F1 - Deployment-facing costs that would decide practical adoption are not reported (at Section 4 Experiments)
- [R3] perspective-F2 - Unstated assumption: a reliable local noise estimate is available before the method is applied (at Section 1 Introduction)
- [DA] da-F2 - Overgeneralization: 'any metric space' is claimed from three tabular/image benchmarks with no supporting experiment (at Section 5 Conclusion)
- [DA] da-F3 - Cherry-pickable benchmark construction: two rotation variants of handwriting data plus an unreleased private set (at Section 4 Experiments)
- [DA] da-F4 - Ignored alternative explanation: the gain may come from fewer training points, not from noise-adaptive radii (at Section 3 Method)

## minor (3)

- [EIC] eic-F3 - Manuscript is at draft-sketch length with no analysis section (at Title page)
- [R1] methodology-F4 - Core hyperparameters and the noise estimator are never specified (at Section 3 Method)
- [R2] domain-F3 - The theoretical framing stops at one attributive sentence (at Section 2 Related Work)

## comment (1)

- [R3] perspective-F3 - Adjacent traditions that would strengthen the contribution are ignored (at Section 2 Related Work)

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
