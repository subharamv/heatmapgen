from shapely.geometry import Point, Polygon
from typing import List, Dict, Any


class ZoneManager:
    def __init__(self):
        self._zones: Dict[str, dict] = {}

    def set_zones(self, zones: List[dict]):
        self._zones = {}
        for z in zones:
            if len(z.get("polygon", [])) >= 3:
                self._zones[z["id"]] = {
                    **z,
                    "_poly": Polygon(z["polygon"]),
                }

    def get_zones(self) -> List[dict]:
        return [
            {k: v for k, v in z.items() if k != "_poly"}
            for z in self._zones.values()
        ]

    def classify_centroids(self, centroids: List[tuple]) -> Dict[str, List[tuple]]:
        """Return mapping of zone_id -> list of centroids inside that zone."""
        result: Dict[str, List[tuple]] = {zid: [] for zid in self._zones}
        for cx, cy in centroids:
            pt = Point(cx, cy)
            for zid, zone in self._zones.items():
                if zone["_poly"].contains(pt):
                    result[zid].append((cx, cy))
        return result

    def check_violations(self, zone_counts: Dict[str, int]) -> List[dict]:
        violations = []
        for zid, count in zone_counts.items():
            zone = self._zones.get(zid)
            if zone and count > zone.get("maxCapacity", 999):
                violations.append({
                    "zoneId": zid,
                    "zoneName": zone.get("name", zid),
                    "count": count,
                    "limit": zone["maxCapacity"],
                })
        return violations
