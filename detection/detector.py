import math
import cv2
import numpy as np
from ultralytics import YOLO
from typing import List, Tuple

def _focal_px(frame_height: int, vfov_deg: float) -> float:
    return (frame_height / 2) / math.tan(math.radians(vfov_deg / 2))


def estimate_distance_m(bbox_height_px: float, person_height_m: float,
                        focal_px: float) -> float:
    if bbox_height_px < 3:
        return 12.0
    return round((person_height_m * focal_px) / bbox_height_px, 2)


class PeopleDetector:
    def __init__(
        self,
        model_name: str = "yolov8s.pt",
        conf_threshold: float = 0.35,
        imgsz: int = 1280,
        preprocessing: bool = True,
        use_tiling: bool = False,
        tile_overlap: float = 0.25,
        focal_ratio: float = 0.55,
        person_height_m: float = 0.4,
        vfov_deg: float = 47.0,
        frame_height: int = 480,
    ):
        self.model = YOLO(model_name)
        self.conf = conf_threshold
        self.imgsz = imgsz
        self.preprocessing = preprocessing
        self.use_tiling = use_tiling
        self.tile_overlap = tile_overlap
        self.focal_ratio = focal_ratio   # top N% of frame = far field for tiling
        self.person_height_m = person_height_m
        self.vfov_deg = vfov_deg
        self.frame_height = frame_height
        self._focal_px = _focal_px(frame_height, vfov_deg)
        self._person_class = 0

        # CLAHE for contrast enhancement in far-field low-contrast areas
        self._clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        # Gentle unsharp-mask kernel for edge enhancement
        self._sharpen_k = np.array(
            [[0, -0.4, 0], [-0.4, 2.6, -0.4], [0, -0.4, 0]], dtype=np.float32
        )

    # ------------------------------------------------------------------
    # Pre-processing
    # ------------------------------------------------------------------

    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        # Apply CLAHE on the L channel only to preserve colour
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l = self._clahe.apply(l)
        enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
        # Unsharp mask for edge crispness
        return cv2.filter2D(enhanced, -1, self._sharpen_k)

    # ------------------------------------------------------------------
    # Inference helpers
    # ------------------------------------------------------------------

    def _run(self, img: np.ndarray, imgsz: int) -> List[dict]:
        results = self.model(
            img,
            classes=[self._person_class],
            conf=self.conf,
            imgsz=imgsz,
            verbose=False,
        )[0]
        dets = []
        for box in results.boxes:
            x1, y1, x2, y2 = map(float, box.xyxy[0].tolist())
            dets.append({
                "bbox": [x1, y1, x2, y2],
                "confidence": float(box.conf[0]),
            })
        return dets

    def _tile_detect(self, frame: np.ndarray) -> List[dict]:
        """SAHI-style tiled inference. Tiles the focal zone and translates
        bounding boxes back to full-frame coordinates."""
        h, w = frame.shape[:2]
        tile_size = 640
        step = int(tile_size * (1 - self.tile_overlap))
        all_dets: List[dict] = []

        y = 0
        while y < h:
            y2 = min(y + tile_size, h)
            x = 0
            while x < w:
                x2 = min(x + tile_size, w)
                tile = frame[y:y2, x:x2]
                for d in self._run(tile, tile_size):
                    bx1, by1, bx2, by2 = d["bbox"]
                    all_dets.append({
                        "bbox": [bx1 + x, by1 + y, bx2 + x, by2 + y],
                        "confidence": d["confidence"],
                    })
                if x2 == w:
                    break
                x += step
            if y2 == h:
                break
            y += step

        return all_dets

    def _nms(self, detections: List[dict]) -> List[dict]:
        if not detections:
            return []
        boxes = [
            [d["bbox"][0], d["bbox"][1],
             d["bbox"][2] - d["bbox"][0], d["bbox"][3] - d["bbox"][1]]
            for d in detections
        ]
        scores = [d["confidence"] for d in detections]
        indices = cv2.dnn.NMSBoxes(boxes, scores, self.conf, 0.45)
        if len(indices) == 0:
            return []
        return [detections[i] for i in indices.flatten()]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> Tuple[List[dict], np.ndarray]:
        proc = self._preprocess(frame) if self.preprocessing else frame

        # Pass 1 — full frame at high resolution (catches nearby + mid-range)
        all_dets = self._run(proc, self.imgsz)

        # Pass 2 — tiled focal zone (upper N% = far field / line-of-sight)
        if self.use_tiling and self.focal_ratio > 0:
            focal_h = int(frame.shape[0] * self.focal_ratio)
            focal_region = proc[:focal_h, :]
            for d in self._tile_detect(focal_region):
                all_dets.append(d)

        detections = self._nms(all_dets)

        annotated = frame.copy()
        final = []
        for d in detections:
            x1, y1, x2, y2 = map(int, d["bbox"])
            conf = d["confidence"]
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            dist = estimate_distance_m(float(y2 - y1), self.person_height_m, self._focal_px)
            final.append({
                "bbox": [x1, y1, x2, y2],
                "centroid": (cx, cy),
                "confidence": round(conf, 3),
                "distance_m": dist,
            })
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.circle(annotated, (cx, cy), 4, (0, 0, 255), -1)
            cv2.putText(annotated, f"{conf:.2f}", (x1, y1 - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        cv2.putText(annotated, f"People: {len(final)}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
        return final, annotated

    def draw_zones(self, frame: np.ndarray, zones: List[dict],
                   zone_counts: dict, violations: List[dict]) -> np.ndarray:
        violation_ids = {v["zoneId"] for v in violations}
        for zone in zones:
            pts = np.array(zone["polygon"], dtype=np.int32)
            color = (0, 0, 255) if zone["id"] in violation_ids else (0, 200, 255)
            cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=2)
            overlay = frame.copy()
            fill_color = (0, 0, 80) if zone["id"] in violation_ids else (0, 80, 0)
            cv2.fillPoly(overlay, [pts], fill_color)
            cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)
            cx = int(np.mean(pts[:, 0]))
            cy = int(np.mean(pts[:, 1]))
            count = zone_counts.get(zone["id"], 0)
            limit = zone.get("maxCapacity", "—")
            cv2.putText(frame, f"{zone['name']}: {count}/{limit}",
                        (cx - 40, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        return frame
