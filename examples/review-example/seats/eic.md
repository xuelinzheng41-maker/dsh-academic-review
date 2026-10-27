# Review card - EIC (Journal-Fit Reviewer / Editor-in-Chief)

- Review: rev-20261027-9e9ab217
- Seat: eic (role marker EIC)
- Verdict: major_revision
- Confidence: 0.72
- Created: 2026-10-27T09:41:00+00:00
- Committed: 2026-10-27T11:26:14+08:00

## Summary

Journal-Fit (EIC) seat. The topic — noise-aware adaptive granular-ball simplification — is within JMLR's scope and the framing is clear, but what is submitted is a four-page sketch rather than a research article: a single mechanism, two baselines, three datasets of which one is private, and no theory, complexity, or variance analysis. As a submission to the stated target venue it is not yet reviewable on quality; the contribution claim outruns what the paper demonstrates.

## Findings

### eic-F1 - Headline benchmark claim conflicts with the evaluation actually described [major]

The introduction claims a 3.1-point average gain 'across three public benchmarks', but the experiments section names only two public benchmarks plus a private sensor set. Either the claim or the evaluation description is wrong, and in either case a numerate reader cannot reproduce the headline number from the paper. This must be reconciled and the private dataset's provenance, size, and licensing stated.

Evidence:

- at Section 1 Introduction: by 3.1 points on average across three public benchmarks.
- at Section 4 Experiments: We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor

### eic-F2 - Novelty claim is asserted, not established, and the contribution is thin for the target venue [major]

The paper's entire novelty argument is one sentence dismissing all prior radius selection as global or per-dataset. No prior method is named, compared against, or cited for that claim, and the empirical section contains no adaptive-radius competitor. For JMLR the delta over existing granular-ball and noise-robust simplification work needs to be demonstrated, not asserted.

Evidence:

- at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either

### eic-F3 - Manuscript is at draft-sketch length with no analysis section [minor]

There is no complexity or runtime analysis, no ablation of the mechanism's two components (splitting and merging), no figures, and no discussion section. The target venue expects a full article. I would not send this to referees in its present form, and the author should decide whether the contribution supports a full submission or a short note.

Evidence:

- at Title page: **Target venue:** Journal of Machine Learning Research (draft)

## Provenance

- peer_output_visible: false (role separation is not independence)
- model: cn:deepseek-v4.1-flash
- context_fresh: true
- human_operator: qa-verifier

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
