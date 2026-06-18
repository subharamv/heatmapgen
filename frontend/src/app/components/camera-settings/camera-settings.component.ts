import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CameraService, CameraSettings, RESOLUTIONS, FPS_OPTIONS,
  DetectionSettings, MODEL_OPTIONS, IMGSZ_OPTIONS,
} from '../../services/camera.service';

@Component({
  selector: 'app-camera-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './camera-settings.component.html',
  styleUrls: ['./camera-settings.component.scss'],
})
export class CameraSettingsComponent implements OnInit {
  open = false;
  activeTab: 'quality' | 'detection' = 'quality';
  saving = false;
  saved = false;
  toggling = false;
  cameraOn = true;

  resolutions = RESOLUTIONS;
  fpsOptions = FPS_OPTIONS;
  modelOptions = MODEL_OPTIONS;
  imgszOptions = IMGSZ_OPTIONS;

  settings: CameraSettings = { width: 1280, height: 720, quality: 92, fps: 30, on: true };
  selectedResIdx = 1;

  det: DetectionSettings = {
    model_name: 'yolov8n.pt',
    conf_threshold: 0.35,
    imgsz: 640,
    preprocessing: true,
    use_tiling: false,
    tile_overlap: 0.25,
    focal_ratio: 0.55,
    person_height_m: 0.4,
    vfov_deg: 47.0,
    frame_height: 480,
  };
  savingDet = false;
  savedDet = false;

  constructor(private cameraSvc: CameraService) {}

  ngOnInit() {
    this.cameraSvc.getSettings().subscribe({
      next: s => {
        this.settings = { ...s };
        this.cameraOn = s.on;
        this.selectedResIdx = this.resolutions.findIndex(
          r => r.width === s.width && r.height === s.height,
        );
        if (this.selectedResIdx < 0) this.selectedResIdx = 0;
      },
      error: () => { /* detection server still starting — defaults remain active */ },
    });
    this.cameraSvc.getDetectionSettings().subscribe({
      next: d => (this.det = { ...d }),
      error: () => {},
    });
  }

  applyDetection() {
    this.savingDet = true;
    this.cameraSvc.updateDetectionSettings(this.det).subscribe({
      next: () => {
        this.savingDet = false;
        this.savedDet = true;
        setTimeout(() => (this.savedDet = false), 2000);
      },
      error: () => (this.savingDet = false),
    });
  }

  toggleCamera() {
    this.toggling = true;
    const req = this.cameraOn ? this.cameraSvc.turnOff() : this.cameraSvc.turnOn();
    req.subscribe({
      next: r => { this.cameraOn = r.on; this.toggling = false; },
      error: () => (this.toggling = false),
    });
  }

  onResolutionChange() {
    const r = this.resolutions[this.selectedResIdx];
    this.settings.width = r.width;
    this.settings.height = r.height;
  }

  apply() {
    this.saving = true;
    this.cameraSvc.updateSettings(this.settings).subscribe({
      next: () => {
        this.saving = false;
        this.saved = true;
        setTimeout(() => (this.saved = false), 2000);
      },
      error: () => (this.saving = false),
    });
  }
}
