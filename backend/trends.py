"""Trend statistics with no heavy dependencies.

Mann-Kendall test (is there a monotonic trend, and is it significant?) and
Sen's slope (how much per year), plus a seasonal Mann-Kendall for monthly data
so the yearly cycle doesn't hide or fake a trend.
"""
import math
from itertools import combinations
from statistics import median


def _norm_p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2))


def _s_and_var(values):
    n = len(values)
    s = sum((b > a) - (b < a) for a, b in combinations(values, 2))
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    ties = sum(t * (t - 1) * (2 * t + 5) for t in counts.values() if t > 1)
    var = (n * (n - 1) * (2 * n + 5) - ties) / 18
    return s, var


def _z(s, var):
    if var <= 0 or s == 0:
        return 0.0
    return (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var)


def mann_kendall(values, alpha=0.05, seasons=None):
    """values: list of floats in time order. seasons: list of season keys (e.g. month) or None."""
    if seasons is None:
        groups = {0: values}
    else:
        groups = {}
        for v, k in zip(values, seasons):
            groups.setdefault(k, []).append(v)
    s_tot, var_tot = 0, 0.0
    for g in groups.values():
        if len(g) >= 3:
            s, var = _s_and_var(g)
            s_tot += s
            var_tot += var
    z = _z(s_tot, var_tot)
    p = _norm_p_two_sided(z)
    if p < alpha:
        direction = "increasing" if z > 0 else "decreasing"
    else:
        direction = "no significant trend"
    return {"s": s_tot, "z": round(z, 4), "p_value": round(p, 6),
            "significant": p < alpha, "alpha": alpha, "trend": direction}


def sens_slope(times, values, seasons=None):
    """Median pairwise slope in value units per time unit (times in years)."""
    pts = list(zip(times, values, seasons or [0] * len(values)))
    slopes = [(v2 - v1) / (t2 - t1) for (t1, v1, k1), (t2, v2, k2) in combinations(pts, 2)
              if t2 != t1 and k1 == k2]
    if not slopes:
        return {"slope_per_year": 0.0, "intercept": median(values) if values else 0.0}
    slope = median(slopes)
    intercept = median(v - slope * t for t, v, _ in pts)
    return {"slope_per_year": slope, "intercept": intercept}


def analyse(times, values, seasons=None, alpha=0.05):
    """Full trend summary for one series. times are decimal years."""
    clean = [(t, v, s) for t, v, s in zip(times, values, seasons or [None] * len(values))
             if v is not None and not math.isnan(v)]
    if len(clean) < 8:
        return {"error": "not enough valid data points", "n": len(clean)}
    t, v, s = map(list, zip(*clean))
    s = None if seasons is None else s
    mk = mann_kendall(v, alpha, s)
    ss = sens_slope(t, v, s)
    span = t[-1] - t[0]
    mean = sum(v) / len(v)
    total = ss["slope_per_year"] * span
    return {
        **mk,
        "slope_per_year": round(ss["slope_per_year"], 6),
        "slope_per_decade": round(ss["slope_per_year"] * 10, 6),
        "total_change": round(total, 6),
        "percent_change": round(100 * total / abs(mean), 3) if mean else None,
        "mean": round(mean, 6),
        "n": len(v),
        "start": t[0], "end": t[-1],
        "seasonal": seasons is not None,
        "trend_line": [[t[0], round(ss["intercept"] + ss["slope_per_year"] * t[0], 6)],
                       [t[-1], round(ss["intercept"] + ss["slope_per_year"] * t[-1], 6)]],
    }
