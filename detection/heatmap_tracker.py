import numpy as np
from collections import deque
from typing import List, Tuple


class HeatmapTracker:
    def __init__(self, frame_width: int = 640, frame_height: int = 480, grid_size: int = 32):
        self.width = frame_width
        self.height = frame_height
        self.grid_size = grid_size
        self.cols = frame_width // grid_size
        self.rows = frame_height // grid_size
        self._grid = np.zeros((self.rows, self.cols), dtype=np.float32)
        self._history: deque = deque(maxlen=1800)  # ~30 min at 1fps

    def record(self, centroids: List[Tuple[int, int]]):
        for cx, cy in centroids:
            col = min(int(cx // self.grid_size), self.cols - 1)
            row = min(int(cy // self.grid_size), self.rows - 1)
            self._grid[row, col] += 1.0
        self._history.append([
            (min(int(cx // self.grid_size), self.cols - 1),
             min(int(cy // self.grid_size), self.rows - 1))
            for cx, cy in centroids
        ])

    def get_heatmap_data(self) -> dict:
        """Return normalized heatmap as a flat list of {x, y, value} points."""
        max_val = self._grid.max()
        if max_val == 0:
            return {"points": [], "width": self.cols, "height": self.rows,
                    "frameWidth": self.width, "frameHeight": self.height}
        normalized = self._grid / max_val
        points = []
        for row in range(self.rows):
            for col in range(self.cols):
                val = float(normalized[row, col])
                if val > 0.01:
                    points.append({"x": col, "y": row, "value": round(val, 3)})
        return {
            "points": points,
            "width": self.cols,
            "height": self.rows,
            "frameWidth": self.width,
            "frameHeight": self.height,
            "gridSize": self.grid_size,
        }

    def reset(self):
        self._grid = np.zeros((self.rows, self.cols), dtype=np.float32)
        self._history.clear()


class SpatialHeatmap:
    """Top-down bird's-eye heatmap: horizontal-angle × depth."""

    def __init__(self, x_cells: int = 40, depth_cells: int = 40,
                 max_depth_m: float = 10.0, hfov_deg: float = 60.0):
        self.x_cells    = x_cells
        self.depth_cells = depth_cells
        self.max_depth_m = max_depth_m
        self.hfov_deg   = hfov_deg
        self._grid      = np.zeros((depth_cells, x_cells), dtype=np.float32)

    def record(self, detections: list, frame_width: int):
        """Record each detection using its centroid x and distance_m."""
        for d in detections:
            cx, _ = d["centroid"]
            dist   = d.get("distance_m", 5.0)
            x_norm  = max(0.0, min(cx / frame_width, 1.0))
            d_ratio = max(0.0, min(dist / self.max_depth_m, 1.0))
            xi  = min(int(x_norm  * self.x_cells),     self.x_cells - 1)
            di  = min(int(d_ratio * self.depth_cells),  self.depth_cells - 1)
            self._grid[di, xi] += 1.0

    def get_data(self) -> dict:
        max_val = self._grid.max()
        points: list = []
        if max_val > 0:
            norm = self._grid / max_val
            for di in range(self.depth_cells):
                for xi in range(self.x_cells):
                    v = float(norm[di, xi])
                    if v > 0.01:
                        # real-world coords: angle (degrees) and distance (metres)
                        angle_deg = (xi / self.x_cells - 0.5) * self.hfov_deg
                        dist_m    = (di + 0.5) / self.depth_cells * self.max_depth_m
                        points.append({
                            "xi": xi, "di": di,
                            "angle_deg": round(angle_deg, 1),
                            "dist_m":    round(dist_m, 2),
                            "value":     round(v, 3),
                        })
        return {
            "points":     points,
            "xCells":     self.x_cells,
            "depthCells": self.depth_cells,
            "maxDepthM":  self.max_depth_m,
            "hfovDeg":    self.hfov_deg,
        }

    def reset(self):
        self._grid = np.zeros((self.depth_cells, self.x_cells), dtype=np.float32)
