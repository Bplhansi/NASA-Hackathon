"""Offline tests: stats on synthetic data, API with a fake NASA POWER response."""
import math, random
from unittest.mock import patch
from fastapi.testclient import TestClient
import main
from trends import analyse


def synth(slope, years=30, noise=0.3, seed=1):
    rnd = random.Random(seed); raw = {}
    for y in range(1991, 1991 + years):
        for m in range(1, 13):
            raw[f"{y}{m:02d}"] = round(10 + 8 * math.sin(m / 12 * 2 * math.pi) + slope * (y - 1991) + rnd.gauss(0, noise), 3)
        raw[f"{y}13"] = 0
    return raw


def test_stats():
    t = [1991 + i / 12 for i in range(360)]
    up = analyse(t, [0.03 * x + random.Random(i).gauss(0, .2) for i, x in enumerate(range(360))], None)
    assert up["trend"] == "increasing" and up["p_value"] < 0.05
    flat = analyse(t, [random.Random(i).gauss(0, 1) for i in range(360)], [i % 12 + 1 for i in range(360)])
    assert not flat["significant"], flat


async def fake_fetch(client, var, lat, lon, start, end):
    raw = synth(0.05 if lat > 0 else -0.05, end - start + 1)
    return [{"date": f"{k[:4]}-{k[4:]}", "t": int(k[:4]) + (int(k[4:]) - .5) / 12, "month": int(k[4:]), "value": v}
            for k, v in sorted(raw.items()) if not k.endswith("13")]


def test_api():
    c = TestClient(main.app)
    assert c.get("/api/variables").status_code == 200
    assert len(c.get("/api/cases").json()) == 3
    with patch.object(main, "fetch_series", fake_fetch):
        r = c.get("/api/trend", params={"var": "T2M", "lat": 51.5, "lon": -0.1}).json()
        assert r["stats"]["trend"] == "increasing" and abs(r["stats"]["slope_per_decade"] - 0.5) < 0.1, r["stats"]
        assert r["annual"] and r["annual_trend_line"]
        g = c.get("/api/trend/grid", params={"var": "T2M", "bbox": "-10,-10,10,10", "n": 4}).json()
        assert g["summary"]["increasing"] == 8 and g["summary"]["decreasing"] == 8, g["summary"]
        cmp = c.get("/api/compare", params={"vars": "T2M,PRECTOTCORR", "lat": -5, "lon": 0}).json()
        assert all(x["stats"]["trend"] == "decreasing" for x in cmp["results"])
    assert c.get("/api/trend", params={"var": "NOPE", "lat": 0, "lon": 0}).status_code == 400
    assert c.get("/api/trend/grid", params={"var": "T2M", "bbox": "1,2"}).status_code == 400
    assert c.get("/api/scan/nowhere").status_code == 404


if __name__ == "__main__":
    test_stats(); test_api(); print("all tests passed")
