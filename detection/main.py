import atexit
import base64
import queue
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

import cv2
import httpx
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from detector import PeopleDetector
from heatmap_tracker import HeatmapTracker, SpatialHeatmap
from zone_manager import ZoneManager

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
_det_settings: dict = {
    "model_name": "yolov8n.pt",
    "conf_threshold": 0.35,
    "imgsz": 640,
    "preprocessing": True,
    "use_tiling": False,
    "tile_overlap": 0.25,
    "focal_ratio": 0.55,
    "person_height_m": 0.4,   # visible body height in frame — tune for seated/close-up setups
    "vfov_deg": 47.0,          # camera vertical field of view in degrees
    "frame_height": 480,       # must match _cam_settings["height"]
}
_detector_lock = threading.Lock()
detector: Optional[PeopleDetector] = None   # loaded in lifespan thread
_detector_ready = threading.Event()
zone_mgr = ZoneManager()
heatmap  = HeatmapTracker(frame_width=640, frame_height=480, grid_size=20)
spatial  = SpatialHeatmap(x_cells=40, depth_cells=40, max_depth_m=10.0)

_latest_frame: Optional[np.ndarray] = None
_latest_jpeg: Optional[bytes] = None
_frame_lock = threading.Lock()
_running = False
_cap: Optional[cv2.VideoCapture] = None
_post_queue: queue.Queue = queue.Queue(maxsize=2)
_restart_event = threading.Event()

_cam_settings: dict = {
    "width": 640,
    "height": 480,
    "quality": 75,
    "fps": 20,
}
_camera_on: bool = True

BACKEND_URL = "http://localhost:3000"


def _make_placeholder(text: str) -> bytes:
    h, w = 720, 1280
    img = np.zeros((h, w, 3), dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    tw, th = cv2.getTextSize(text, font, 1.2, 2)[0]
    cv2.putText(img, text, ((w - tw) // 2, (h + th) // 2),
                font, 1.2, (0, 180, 90), 2, cv2.LINE_AA)
    _, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return enc.tobytes()


_LOADING_JPEG = _make_placeholder("Initializing camera...")
_OFFLINE_JPEG = _make_placeholder("Camera Off")

# ---------------------------------------------------------------------------
# Camera loop (background thread)
# ---------------------------------------------------------------------------

def _post_worker():
    client = httpx.Client(timeout=1.0)
    while _running:
        try:
            payload = _post_queue.get(timeout=0.5)
            try:
                client.post(f"{BACKEND_URL}/api/frame-data", json=payload)
            except Exception:
                pass
        except queue.Empty:
            continue
    client.close()


def _release_cap():
    global _cap
    if _cap is not None:
        try:
            _cap.release()
        except Exception:
            pass
        _cap = None
        print("[Camera] Released")

atexit.register(_release_cap)


def camera_loop(source: int | str = 0):
    global _running, _cap, _latest_frame, _latest_jpeg

    # Wait for the YOLO model to finish loading before capturing frames
    print("[Camera] Waiting for model...")
    _detector_ready.wait()
    print("[Camera] Model ready — starting capture")

    while _running:
        if not _camera_on:
            time.sleep(0.2)
            continue

        _restart_event.clear()
        w = _cam_settings["width"]
        h = _cam_settings["height"]

        _cap = cv2.VideoCapture(source)
        _cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        _cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        _cap.set(cv2.CAP_PROP_FPS, _cam_settings["fps"])

        if not _cap.isOpened():
            print("[Camera] Default backend failed, trying CAP_DSHOW")
            _cap.release()
            _cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
            _cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            _cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)

        frame_interval = 1.0 / max(_cam_settings["fps"], 1)

        try:
            while _running and not _restart_event.is_set() and _camera_on:
                t0 = time.time()
                ret, frame = _cap.read()
                if not ret:
                    time.sleep(0.05)
                    continue

                with _detector_lock:
                    det = detector
                detections, annotated = det.detect(frame)
                centroids = [d["centroid"] for d in detections]

                zone_membership = zone_mgr.classify_centroids(centroids)
                zone_counts = {zid: len(pts) for zid, pts in zone_membership.items()}
                violations = zone_mgr.check_violations(zone_counts)

                annotated = det.draw_zones(annotated, zone_mgr.get_zones(),
                                           zone_counts, violations)
                heatmap.record(centroids)
                spatial.record(detections, w)

                _, jpeg = cv2.imencode(".jpg", annotated,
                                       [cv2.IMWRITE_JPEG_QUALITY, _cam_settings["quality"]])
                with _frame_lock:
                    _latest_frame = annotated.copy()
                    _latest_jpeg = jpeg.tobytes()

                payload = {
                    "totalCount": len(detections),
                    "zoneCounts": zone_counts,
                    "violations": violations,
                    "detections": [
                        {"bbox": d["bbox"], "centroid": list(d["centroid"]),
                         "confidence": d["confidence"],
                         "distance_m": d.get("distance_m", 5.0)}
                        for d in detections
                    ],
                }
                try:
                    _post_queue.put_nowait(payload)
                except queue.Full:
                    pass

                elapsed = time.time() - t0
                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
        finally:
            _release_cap()

        if not _camera_on:
            with _frame_lock:
                _latest_jpeg = None
                _latest_frame = None


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

def _load_model():
    """Load YOLO in a background thread so uvicorn binds to port 8000 immediately."""
    global detector
    print("[Detection] Loading YOLO model (this may take 10-20 s)...")
    with _detector_lock:
        detector = PeopleDetector(**_det_settings)
    _detector_ready.set()
    print("[Detection] YOLO model ready")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _running
    _running = True
    threading.Thread(target=_load_model, daemon=True).start()
    t = threading.Thread(target=camera_loop, args=(0,), daemon=True)
    t.start()
    p = threading.Thread(target=_post_worker, daemon=True)
    p.start()
    yield
    _running = False
    _detector_ready.set()  # unblock camera_loop if still waiting
    _restart_event.set()   # unblock inner loop immediately
    t.join(timeout=10)     # allow up to one slow inference frame to finish
    p.join(timeout=2)
    _release_cap()         # final guarantee if thread timed out


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="People Counter Detection Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _mjpeg_generator():
    while _running:
        with _frame_lock:
            jpeg = _latest_jpeg
        if jpeg is None:
            jpeg = _OFFLINE_JPEG if not _camera_on else _LOADING_JPEG
        # Content-Length tells the browser exactly how many bytes to read per frame
        length = len(jpeg)
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(length).encode() + b"\r\n\r\n"
            + jpeg + b"\r\n"
        )
        time.sleep(0.033)


@app.get("/stream")
def video_stream():
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.get("/snapshot")
def snapshot():
    with _frame_lock:
        jpeg = _latest_jpeg
    if not jpeg:
        jpeg = _OFFLINE_JPEG if not _camera_on else _LOADING_JPEG
    b64 = base64.b64encode(jpeg).decode()
    return {"image": f"data:image/jpeg;base64,{b64}"}


@app.get("/snapshot-img")
def snapshot_img():
    with _frame_lock:
        jpeg = _latest_jpeg
    if not jpeg:
        jpeg = _OFFLINE_JPEG if not _camera_on else _LOADING_JPEG
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@app.get("/heatmap")
def get_heatmap():
    return heatmap.get_heatmap_data()


@app.post("/heatmap/reset")
def reset_heatmap():
    heatmap.reset()
    spatial.reset()
    return {"status": "reset"}


@app.get("/heatmap/spatial")
def get_spatial_heatmap():
    return spatial.get_data()


class ZonesPayload(BaseModel):
    zones: list


@app.post("/zones")
def update_zones(payload: ZonesPayload):
    zone_mgr.set_zones(payload.zones)
    return {"status": "ok", "count": len(payload.zones)}


@app.get("/zones")
def list_zones():
    return {"zones": zone_mgr.get_zones()}


@app.get("/health")
def health():
    return {"status": "ok", "camera": _cap is not None and _cap.isOpened()}


class CameraSettingsPayload(BaseModel):
    width: Optional[int] = None
    height: Optional[int] = None
    quality: Optional[int] = None
    fps: Optional[int] = None


@app.get("/camera/settings")
def get_camera_settings():
    return {**_cam_settings, "on": _camera_on}


@app.post("/camera/settings")
def update_camera_settings(payload: CameraSettingsPayload):
    updated = payload.model_dump(exclude_none=True)
    _cam_settings.update(updated)
    _restart_event.set()
    return {"status": "ok", "settings": {**_cam_settings, "on": _camera_on}}


class DetectionSettingsPayload(BaseModel):
    model_name: Optional[str] = None
    conf_threshold: Optional[float] = None
    imgsz: Optional[int] = None
    preprocessing: Optional[bool] = None
    use_tiling: Optional[bool] = None
    tile_overlap: Optional[float] = None
    focal_ratio: Optional[float] = None
    person_height_m: Optional[float] = None
    vfov_deg: Optional[float] = None
    frame_height: Optional[int] = None


@app.get("/detection/settings")
def get_detection_settings():
    return _det_settings


@app.post("/detection/settings")
def update_detection_settings(payload: DetectionSettingsPayload):
    global detector
    updated = payload.model_dump(exclude_none=True)
    _det_settings.update(updated)
    new_detector = PeopleDetector(**_det_settings)
    with _detector_lock:
        detector = new_detector
    return {"status": "ok", "settings": _det_settings}


@app.post("/camera/on")
def camera_turn_on():
    global _camera_on
    _camera_on = True
    _restart_event.set()   # wake the outer loop immediately (≤200ms wait otherwise)
    return {"status": "ok", "on": True}


@app.post("/camera/off")
def camera_turn_off():
    global _camera_on
    _camera_on = False
    _restart_event.set()
    return {"status": "ok", "on": False}
