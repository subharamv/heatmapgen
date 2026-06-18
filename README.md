# People Counter

Real-time people detection, zone-based capacity enforcement, and movement heatmap — built with Angular, Node.js, Python (YOLOv8), PostgreSQL, and Redis.

## Architecture

```
Angular (UI) <--Socket.io--> Node.js API <--HTTP--> Python Detection (YOLOv8 + OpenCV)
                                  |
                         PostgreSQL + Redis (Docker)
```

## Prerequisites

- Node.js 18+
- Python 3.10+
- Docker Desktop (for PostgreSQL + Redis)
- Webcam or IP camera

## Quick Start

### 1. First-time setup (run once)
```powershell
.\setup.ps1
```

### 2. Start everything
```powershell
.\start.ps1
```

Opens 3 terminal windows:
| Service | URL |
|---|---|
| Angular UI | http://localhost:4200 |
| Node.js API | http://localhost:3000 |
| Detection (MJPEG) | http://localhost:8000/stream |

## Manual Start (if start.ps1 doesn't suit)

```powershell
# Terminal 1 — Docker
docker compose up -d

# Terminal 2 — Backend
cd backend; node src/index.js

# Terminal 3 — Detection
cd detection; uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 4 — Frontend
cd frontend; npx ng serve
```

## Features

| Feature | How it works |
|---|---|
| Live camera feed | MJPEG stream from Python → displayed in Angular |
| People detection | YOLOv8 nano (CPU) — ~8–15 FPS on your Ryzen 7 |
| Zone drawing | Click to draw polygon on camera feed canvas |
| Capacity limit | Set max people per zone; alerts fire when exceeded |
| Real-time count | Socket.io pushes updates every frame |
| Alert panel | In-app toast + audio beep + DB log per violation |
| Heatmap | Centroid grid accumulation → heatmap.js overlay |

## Using the App

1. Open http://localhost:4200
2. In the **right sidebar**, click **Draw Zone**
3. Click points on the camera feed to draw a polygon around your restricted area
4. Double-click to close the polygon
5. Enter a zone name and max capacity → **Save Zone**
6. Watch the live count and alerts as people enter/leave the zone
7. Switch to the **Heatmap** tab to see movement density over time

## Camera source

Edit `detection/main.py` — change the `camera_loop` call:
```python
# Webcam (default)
t = threading.Thread(target=camera_loop, args=(0,), daemon=True)

# IP camera / RTSP
t = threading.Thread(target=camera_loop, args=("rtsp://192.168.1.100/stream",), daemon=True)

# Video file (for testing)
t = threading.Thread(target=camera_loop, args=("test.mp4",), daemon=True)
```

## Project Structure

```
people-counter/
├── detection/          Python FastAPI — YOLOv8, OpenCV, zone checks, heatmap
├── backend/            Node.js — Express, Socket.io, PostgreSQL, Redis, alerts
├── frontend/           Angular 17 — dashboard, camera feed, zone manager, heatmap
├── docker-compose.yml  PostgreSQL + Redis
├── setup.ps1           First-time dependency installer
└── start.ps1           Launch all services
```
