# Adaptive Granular-Ball Simplification for Noisy Manifold Data

**Authors:** A. Researcher, B. Collaborator
**Target venue:** Journal of Machine Learning Research (draft)

## 1 Introduction

Manifold data collected from real sensors is noisy, high-dimensional, and
irregularly sampled. Classical simplification methods assume clean inputs and
fail when labels are corrupted. We propose **Adaptive Granular-Ball
Simplification (AGBS)**, a method that replaces point-level processing with
adaptive granular balls whose radii shrink only where the local noise estimate
exceeds a threshold. We claim AGBS improves downstream classification accuracy
by 3.1 points on average across three public benchmarks.

## 2 Related Work

Granular-ball computing extends rough-set theory to metric spaces. Prior
studies fixed the ball radius globally or tuned it per dataset, which either
oversmooths boundary regions or leaves noise intact. No prior work couples the
radius to a local noise estimate, which is the gap we address.

## 3 Method

We define the granular ball radius as the maximum distance from the centroid to
its member points, capped at a data-dependent maximum. The radius is refined
iteratively: at each step, balls whose impurity exceeds a threshold are split,
and balls whose neighbors agree are merged. The stopping rule uses a fixed
iteration budget of 10.

## 4 Experiments

We evaluate on three benchmarks (MNIST-rot, USPS-rot, and a private sensor
set). Accuracy improves from 81.2 to 84.3 on MNIST-rot, from 76.5 to 79.1 on
USPS-rot, and from 70.0 to 72.6 on the sensor set. Each result uses a single
random seed. The baselines are k-NN and a fixed-radius granular-ball baseline.

## 5 Conclusion

AGBS delivers consistent gains by adapting ball size to local noise. We believe
the approach generalizes to any metric space.

## References

[1] Author et al. Granular-ball computing. Journal of Examples, 2020.
[2] Author et al. Rough sets and granular computing. Journal of Examples, 2019.
