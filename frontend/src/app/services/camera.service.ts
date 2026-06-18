import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CameraSettings {
  width: number;
  height: number;
  quality: number;
  fps: number;
  on: boolean;
}

export const RESOLUTIONS = [
  { label: '640 × 480 (SD)', width: 640, height: 480 },
  { label: '1280 × 720 (HD)', width: 1280, height: 720 },
  { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
];

export const FPS_OPTIONS = [10, 15, 24, 30];

@Injectable({ providedIn: 'root' })
export class CameraService {
  private base = '/detection-api';

  constructor(private http: HttpClient) {}

  getSettings(): Observable<CameraSettings> {
    return this.http.get<CameraSettings>(`${this.base}/camera/settings`);
  }

  updateSettings(settings: Partial<CameraSettings>): Observable<{ status: string; settings: CameraSettings }> {
    return this.http.post<{ status: string; settings: CameraSettings }>(
      `${this.base}/camera/settings`,
      settings,
    );
  }

  turnOn(): Observable<{ status: string; on: boolean }> {
    return this.http.post<{ status: string; on: boolean }>(`${this.base}/camera/on`, {});
  }

  turnOff(): Observable<{ status: string; on: boolean }> {
    return this.http.post<{ status: string; on: boolean }>(`${this.base}/camera/off`, {});
  }

  getDetectionSettings(): Observable<DetectionSettings> {
    return this.http.get<DetectionSettings>(`${this.base}/detection/settings`);
  }

  updateDetectionSettings(s: Partial<DetectionSettings>): Observable<{ status: string; settings: DetectionSettings }> {
    return this.http.post<{ status: string; settings: DetectionSettings }>(
      `${this.base}/detection/settings`, s,
    );
  }
}

export interface DetectionSettings {
  model_name: string;
  conf_threshold: number;
  imgsz: number;
  preprocessing: boolean;
  use_tiling: boolean;
  tile_overlap: number;
  focal_ratio: number;
  person_height_m: number;
  vfov_deg: number;
  frame_height: number;
}

export const MODEL_OPTIONS = [
  { value: 'yolov8n.pt', label: 'Nano — fastest' },
  { value: 'yolov8s.pt', label: 'Small — balanced' },
  { value: 'yolov8m.pt', label: 'Medium — accurate' },
];

export const IMGSZ_OPTIONS = [
  { value: 640,  label: '640 px — fast' },
  { value: 1280, label: '1280 px — sharp' },
];
