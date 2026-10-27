# Review card - R3 (Peer Reviewer 3 - Perspective)

- Review: rev-20261027-9e9ab217
- Seat: perspective (role marker R3)
- Verdict: minor_revision
- Confidence: 0.58
- Created: 2026-10-27T09:50:00+00:00
- Committed: 2026-10-27T11:26:14+08:00

## Summary

Perspective seat (R3). Read as a practitioner-facing contribution, the idea is genuinely appealing: shrinking granularity only where noise is detected is a sensible cost/accuracy trade for sensor pipelines, and it connects naturally to data reduction, active learning, and edge deployment. The paper, however, never engages any of those connections and never reports the operating costs that would decide adoption. My concerns are about framing and scope rather than about the core idea, which is why I am more lenient than my colleagues on the numbers.

## Findings

### perspective-F1 - Deployment-facing costs that would decide practical adoption are not reported [major]

For the sensor use case the paper motivates, the relevant questions are ball count versus accuracy, per-sample inference cost, memory footprint, and behaviour under distribution shift. None are measured. A short results table reporting compression ratio, training time, and inference time at matched accuracy would make the practical claim assessable and would also serve the methodological concern about whether the gain comes from fewer training points.

Evidence:

- at Section 4 Experiments: We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor

### perspective-F2 - Unstated assumption: a reliable local noise estimate is available before the method is applied [major]

The entire mechanism is conditioned on a local noise estimate being high or low, but the paper never says how that estimate is obtained, nor whether it is available in the regime it targets. If labels are corrupted as claimed in the introduction, estimating noise from those same labels risks circularity. State the noise estimator, its data requirements, and what the method does when the estimate is itself unreliable.

Evidence:

- at Section 1 Introduction: exceeds a threshold. We claim AGBS improves downstream classification accuracy

### perspective-F3 - Adjacent traditions that would strengthen the contribution are ignored [comment]

Prototype selection and instance reduction, active learning under label noise, and coreset construction all solve a closely related problem and offer both baselines and terminology. Connecting to them would sharpen the contribution claim, give reviewers familiar comparison points, and likely suggest cheap extra experiments. The private-set provenance also deserves an explicit privacy/data-governance sentence, since the paper's framing is a real deployment.

Evidence:

- at Section 2 Related Work: Prior studies fixed the ball radius globally or tuned it per dataset, which either

## Provenance

- peer_output_visible: false (role separation is not independence)
- model: cn:deepseek-v4.1-flash
- context_fresh: true
- human_operator: qa-verifier

---

Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.
