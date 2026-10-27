# Review card - R2 (Peer Reviewer 2 - Domain)

- Review: rev-20261027-9e9ab217
- Seat: domain (role marker R2)
- Verdict: major_revision
- Confidence: 0.70
- Created: 2026-10-27T09:47:00+00:00
- Committed: 2026-10-27T11:26:14+08:00

## Summary

Domain seat (R2). The paper sits in granular-ball computing and noise-robust learning, two literatures with substantial prior work on locally adaptive metric and neighbourhood size. The related-work section is a single paragraph whose novelty claim is made against an unnamed literature, and the reference list has two entries. The gap statement may well be true, but as written nothing lets a reader trained in this area verify it, and the baseline the paper uses in its own experiments is itself uncited.

## Findings

### domain-F1 - Claim of a completely open gap is made without naming or citing any prior method that closes it partially [major]

'No prior work couples the radius to a local noise estimate' is a universal negative that needs either a cited survey or a systematic comparison. Granular computing, rough-set neighbourhood methods, and locally adaptive kernel/neighbourhood selection all contain closely adjacent ideas, and some of them tie scale to local density or label purity. Name the closest prior methods, state precisely how coupling to a *noise* estimate differs from coupling to density or impurity, and soften the claim if the distinction is narrower than stated.

Evidence:

- at Section 2 Related Work: Granular-ball computing extends rough-set theory to metric spaces. Prior

### domain-F2 - Reference list of two entries cannot support the positioning claims [major]

Two references, both with the placeholder venue 'Journal of Examples', cannot establish coverage of granular-ball computing, rough-set theory, or noisy-label learning. Notably the fixed-radius granular-ball baseline used in the experiments is not cited at all, so the primary comparison point has no attributable source. Expand the bibliography to the actual foundational papers and cite the baseline implementation.

Evidence:

- at References: [1] Author et al. Granular-ball computing. Journal of Examples, 2020.

### domain-F3 - The theoretical framing stops at one attributive sentence [minor]

The rough-set/granular-computing lineage is invoked but never used: no formal definition of a granular ball is given, no relationship between the proposed radius rule and existing granular-ball constructions is stated, and no property (consistency, coverage, or bounds on the ball count) is proved. Even a short formal section would let the community place the contribution relative to the existing theory it claims to extend.

Evidence:

- at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either

## Provenance

- peer_output_visible: false (role separation is not independence)
- model: cn:deepseek-v4.1-flash
- context_fresh: true
- human_operator: qa-verifier

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
