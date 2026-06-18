import {
  Component, ElementRef, ViewChild, AfterViewInit,
  OnDestroy, Input, OnChanges, SimpleChanges, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Zone, CountUpdate } from '../../models/zone.model';

// MJPEG stream — browser keeps one persistent connection, no polling needed
const STREAM_URL = 'http://localhost:8000/stream';

@Component({
  selector: 'app-camera-feed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './camera-feed.component.html',
  styleUrls: ['./camera-feed.component.scss'],
})
export class CameraFeedComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('feedImg') feedImg!: ElementRef<HTMLImageElement>;

  @Input() zones: Zone[] = [];
  @Input() countUpdate: CountUpdate | null = null;
  @Input() drawingMode = false;
  @Input() cameraOff = false;

  @Input() onZoneDrawn?: (polygon: [number, number][]) => void;

  frameUrl = STREAM_URL;
  loading = true;

  private ctx!: CanvasRenderingContext2D;
  private _points: [number, number][] = [];
  private _raf = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this._raf = requestAnimationFrame(() => this.drawOverlay());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.ctx && (changes['countUpdate'] || changes['zones'])) {
      this.drawOverlay();
    }
    if (changes['cameraOff']) {
      this._applyStreamState();
    }
  }

  ngOnDestroy() {
    cancelAnimationFrame(this._raf);
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this.frameUrl = '';  // disconnect stream
  }

  // ── Stream state ────────────────────────────────────────────────────

  private _applyStreamState() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this.cameraOff) {
      this.frameUrl = '';
      this.loading = false;
    } else {
      this.frameUrl = `${STREAM_URL}?t=${Date.now()}`;
      // Don't wait for (load) — browsers don't reliably fire it on MJPEG streams.
      // Show stream immediately; server sends a placeholder JPEG while camera warms up.
      this.loading = false;
    }
    this.cdr.markForCheck();
  }

  // (load) fires on static images; for MJPEG it may fire or not — either way fine
  onImgLoad() {
    this.loading = false;
    this.cdr.markForCheck();
  }

  // Stream error (server down) — retry after 3 s
  onImgError() {
    this.loading = false;
    this.cdr.markForCheck();
    if (!this.cameraOff) {
      this._retryTimer = setTimeout(() => this._applyStreamState(), 3000);
    }
  }

  // ── Drawing mode ────────────────────────────────────────────────────

  onCanvasClick(e: MouseEvent) {
    if (!this.drawingMode) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    this._points.push([
      Math.round(e.clientX - rect.left),
      Math.round(e.clientY - rect.top),
    ]);
    this.drawOverlay();
  }

  onCanvasDblClick(e: MouseEvent) {
    if (!this.drawingMode || this._points.length < 3) return;
    e.preventDefault();
    if (this.onZoneDrawn) this.onZoneDrawn([...this._points]);
    this._points = [];
    this.drawOverlay();
  }

  cancelDrawing() {
    this._points = [];
    this.drawOverlay();
  }

  // ── Canvas overlay ──────────────────────────────────────────────────

  private drawOverlay() {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const img = this.feedImg?.nativeElement;
    if (!img) return;

    canvas.width = img.clientWidth || 640;
    canvas.height = img.clientHeight || 480;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / 1280;
    const scaleY = canvas.height / 720;

    for (const zone of this.zones) {
      const count = this.countUpdate?.zoneCounts[zone.id] ?? 0;
      const violated = this.countUpdate?.violations.some(v => v.zoneId === zone.id) ?? false;
      this._drawZone(zone, count, violated, scaleX, scaleY);
    }

    if (this._points.length > 0) {
      this.ctx.beginPath();
      this.ctx.strokeStyle = '#00e5ff';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 3]);
      this._points.forEach(([x, y], i) =>
        i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y));
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      for (const [x, y] of this._points) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = '#00e5ff';
        this.ctx.fill();
      }
    }

    this._raf = requestAnimationFrame(() => this.drawOverlay());
  }

  private _drawZone(zone: Zone, count: number, violated: boolean,
                    sx: number, sy: number) {
    if (zone.polygon.length < 3) return;
    const pts = zone.polygon.map(([x, y]) => [x * sx, y * sy] as [number, number]);

    this.ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y));
    this.ctx.closePath();

    this.ctx.fillStyle = violated ? 'rgba(255,50,50,0.18)' : 'rgba(0,200,100,0.12)';
    this.ctx.fill();
    this.ctx.strokeStyle = violated ? '#ff3232' : '#00c864';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
    const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
    this.ctx.font = 'bold 13px Segoe UI';
    this.ctx.fillStyle = violated ? '#ff5555' : '#00e5a0';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${zone.name}: ${count}/${zone.maxCapacity}`, cx, cy);
  }
}
