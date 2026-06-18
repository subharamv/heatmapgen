import {
  Component, ElementRef, ViewChild, AfterViewInit,
  OnDestroy, OnInit, ChangeDetectorRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ZoneService } from '../../services/zone.service';
import { SocketService } from '../../services/socket.service';
import { HeatmapData, SpatialHeatmapData, Detection } from '../../models/zone.model';

declare const h337: any;

type ViewMode = 'classic' | 'birdseye' | '3d' | 'live3d';

const FRAME_W     = 640;
const HFOV_DEG    = 60.0;
const MAX_DEPTH_M = 10.0;

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.scss'],
})
export class HeatmapComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('heatmapContainer') container!: ElementRef<HTMLDivElement>;
  @ViewChild('birdsEyeCanvas')   beCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('perspCanvas')      p3Canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('live3dCanvas')     liveCanvas!: ElementRef<HTMLCanvasElement>;

  private heatmapInstance: any = null;
  private refreshInterval: any;
  private liveSub?: Subscription;
  private lastDetections: Detection[] = [];
  private liveRafId = 0;

  view: ViewMode = 'classic';
  loading = false;
  lastUpdated: string | null = null;
  spatialData: SpatialHeatmapData | null = null;
  autoRefresh = true;
  liveCount = 0;

  constructor(
    private zoneSvc: ZoneService,
    private socket: SocketService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
  ) {}

  ngOnInit() {
    this.loadScript().then(() => {
      if (this.container) this.initHeatmap();
    });

    // Subscribe to live socket for the Live 3D tab
    this.liveSub = this.socket.countUpdate$.subscribe(update => {
      this.lastDetections = update.detections ?? [];
      this.liveCount      = update.totalCount ?? 0;
      if (this.view === 'live3d') {
        this.ngZone.runOutsideAngular(() => {
          cancelAnimationFrame(this.liveRafId);
          this.liveRafId = requestAnimationFrame(() => this.drawLive3D(this.lastDetections));
        });
      }
    });
  }

  ngAfterViewInit() {
    if (typeof h337 !== 'undefined') this.initHeatmap();
    this.refreshInterval = setInterval(() => {
      if (this.autoRefresh && this.view !== 'live3d') this.refresh();
    }, 2000);
    setTimeout(() => this.refresh(), 0);
  }

  ngOnDestroy() {
    clearInterval(this.refreshInterval);
    cancelAnimationFrame(this.liveRafId);
    this.liveSub?.unsubscribe();
  }

  setView(v: ViewMode) {
    this.view = v;
    if (v === 'live3d') {
      // Render current state immediately when switching in
      setTimeout(() => this.drawLive3D(this.lastDetections), 50);
    } else {
      setTimeout(() => this.refresh(), 50);
    }
  }

  refresh() {
    if (this.view === 'classic')  this.refreshClassic();
    if (this.view === 'birdseye') this.refreshSpatial();
    if (this.view === '3d')       this.refreshSpatial();
  }

  reset() {
    this.zoneSvc.resetHeatmap().subscribe(() => {
      this.spatialData = null;
      if (this.heatmapInstance) this.heatmapInstance.setData({ max: 1, data: [] });
      this.clearCanvas();
    });
  }

  // ── Classic heatmap ──────────────────────────────────────────────────

  initHeatmap() {
    if (!this.container?.nativeElement || this.heatmapInstance) return;
    this.heatmapInstance = h337.create({
      container: this.container.nativeElement,
      maxOpacity: 0.88,
      minOpacity: 0,
      blur: 0.93,
      radius: 70,
      gradient: {
        '0.00': '#000080',
        '0.20': '#0044ff',
        '0.38': '#00c8ff',
        '0.54': '#00ff88',
        '0.68': '#aaff00',
        '0.80': '#ffdd00',
        '0.90': '#ff6600',
        '1.00': '#ff0000',
      },
    });
  }

  private refreshClassic() {
    this.loading = true;
    this.cdr.markForCheck();
    this.zoneSvc.getHeatmap().subscribe({
      next: (data: HeatmapData) => {
        this.renderClassic(data);
        this.lastUpdated = new Date().toLocaleTimeString();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private renderClassic(data: HeatmapData) {
    if (!this.heatmapInstance || !data.points.length) return;
    const cw = this.container.nativeElement.clientWidth;
    const ch = this.container.nativeElement.clientHeight;
    const sx = cw / data.width;
    const sy = ch / data.height;
    this.heatmapInstance.setData({
      max: 1,
      data: data.points.map(p => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy), value: p.value })),
    });
  }

  // ── Historical spatial heatmap ───────────────────────────────────────

  private refreshSpatial() {
    this.loading = true;
    this.cdr.markForCheck();
    this.zoneSvc.getSpatialHeatmap().subscribe({
      next: (data) => {
        this.spatialData = data;
        this.lastUpdated = new Date().toLocaleTimeString();
        this.loading = false;
        this.cdr.markForCheck();
        this.ngZone.runOutsideAngular(() => {
          requestAnimationFrame(() => {
            if (this.view === 'birdseye') this.drawBirdsEye(data);
            if (this.view === '3d')       this.drawPerspective(data);
          });
        });
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private clearCanvas() {
    [this.beCanvas, this.p3Canvas, this.liveCanvas].forEach(ref => {
      const c = ref?.nativeElement;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    });
  }

  // ── Gaussian smoothing ───────────────────────────────────────────────

  private gaussianSmooth(grid: Float32Array, rows: number, cols: number, sigma = 2.0): Float32Array {
    const kRadius = Math.ceil(sigma * 3);
    const kernel: number[] = [];
    let kSum = 0;
    for (let i = -kRadius; i <= kRadius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(v); kSum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

    const tmp = new Float32Array(rows * cols);
    const out = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let k = -kRadius; k <= kRadius; k++)
          s += grid[r * cols + Math.max(0, Math.min(cols - 1, c + k))] * kernel[k + kRadius];
        tmp[r * cols + c] = s;
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let k = -kRadius; k <= kRadius; k++)
          s += tmp[Math.max(0, Math.min(rows - 1, r + k)) * cols + c] * kernel[k + kRadius];
        out[r * cols + c] = s;
      }
    return out;
  }

  private normalise(arr: Float32Array): Float32Array {
    let max = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    if (max === 0) return arr;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
    return out;
  }

  // ── Colormap: professional inferno-jet ───────────────────────────────

  private heatRGBA(v: number, maxAlpha = 230): [number, number, number, number] {
    if (v <= 0) return [0, 0, 0, 0];
    const stops: [number, [number, number, number]][] = [
      [0.00, [  0,   0,  90]],
      [0.12, [  0,   0, 220]],
      [0.28, [  0, 130, 255]],
      [0.44, [  0, 230, 200]],
      [0.58, [ 80, 255,   0]],
      [0.70, [220, 230,   0]],
      [0.82, [255, 100,   0]],
      [1.00, [255,   0,   0]],
    ];
    let i = stops.findIndex(([t]) => t >= v);
    if (i <= 0) i = 1;
    if (i >= stops.length) i = stops.length - 1;
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    const f = (v - t0) / (t1 - t0);
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * f),
      Math.round(c0[1] + (c1[1] - c0[1]) * f),
      Math.round(c0[2] + (c1[2] - c0[2]) * f),
      Math.round(maxAlpha * Math.pow(v, 0.55)),
    ];
  }

  // ── Shared perspective projection ────────────────────────────────────

  private makeProjector(W: number, H: number, XC: number, DC: number) {
    const VANISH_Y = H * 0.07;
    const NEAR_Y   = H * 0.95;
    const NEAR_W   = W * 0.90;
    const FAR_W    = W * 0.12;
    return (xi: number, di: number) => {
      const nd = di / DC;
      const y  = NEAR_Y + (VANISH_Y - NEAR_Y) * nd;
      const hw = (NEAR_W + (FAR_W - NEAR_W) * nd) / 2;
      return { x: W / 2 + (xi / XC - 0.5) * 2 * hw, y, nd };
    };
  }

  // ── Floor grid helper ─────────────────────────────────────────────────

  private drawFloorGrid(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    XC: number, DC: number,
    project: (xi: number, di: number) => { x: number; y: number; nd: number },
  ) {
    ctx.strokeStyle = 'rgba(0,140,200,0.10)';
    ctx.lineWidth   = 0.4;
    const xStep = Math.max(1, Math.floor(XC / 12));
    const dStep = Math.max(1, Math.floor(DC / 8));
    for (let xi = 0; xi <= XC; xi += xStep) {
      const n = project(xi, 0), f = project(xi, DC);
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(f.x, f.y); ctx.stroke();
    }
    for (let di = 0; di <= DC; di += dStep) {
      const l = project(0, di), r = project(XC, di);
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    }
  }

  // ── LIVE 3D view ─────────────────────────────────────────────────────

  drawLive3D(detections: Detection[]) {
    const canvas = this.liveCanvas?.nativeElement;
    if (!canvas) return;
    const W = canvas.width  = canvas.offsetWidth  || 640;
    const H = canvas.height = canvas.offsetHeight || 420;
    const ctx = canvas.getContext('2d')!;

    const XC = 40, DC = 40;
    const project = this.makeProjector(W, H, XC, DC);

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#04060e');
    bg.addColorStop(1, '#090d1c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    this.drawFloorGrid(ctx, W, H, XC, DC, project);

    // Distance labels on left edge
    ctx.font      = 'bold 10px system-ui';
    ctx.fillStyle = 'rgba(0,180,220,0.45)';
    ctx.textAlign = 'right';
    for (let d = 2; d <= MAX_DEPTH_M; d += 2) {
      const di = (d / MAX_DEPTH_M) * DC;
      const pt = project(0, di);
      ctx.fillText(`${d}m`, pt.x - 4, pt.y + 4);
    }

    // Camera icon
    const cam = project(XC / 2, 0);
    ctx.save();
    ctx.shadowBlur  = 14;
    ctx.shadowColor = '#00e5ff';
    ctx.fillStyle   = '#00e5ff';
    ctx.beginPath(); ctx.arc(cam.x, cam.y + 12, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,229,255,0.55)';
    ctx.textAlign = 'center';
    ctx.font = '10px system-ui';
    ctx.fillText('CAM', cam.x, cam.y + 25);

    if (detections.length === 0) {
      // Empty state — no blobs, just a subtle message
      ctx.fillStyle = 'rgba(40,55,80,0.7)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No people in frame', W / 2, H / 2 - 10);
      ctx.font = '11px system-ui';
      ctx.fillStyle = 'rgba(40,55,80,0.45)';
      ctx.fillText('Heatmap will appear when someone is detected', W / 2, H / 2 + 12);
      return;
    }

    // Map each detection to 3D grid coordinates
    const persons = detections.map((det, idx) => {
      // Use Python's pre-computed distance (calibrated with person_height_m + vfov_deg)
      const distM  = Math.min(det.distance_m ?? MAX_DEPTH_M, MAX_DEPTH_M);
      const xNorm  = det.centroid[0] / FRAME_W;
      const xi     = xNorm * XC;
      const di     = (distM / MAX_DEPTH_M) * DC;
      // Colour cycles through a set of distinct vivid hues per person slot
      const hues   = [180, 140, 60, 320, 270, 30, 200];
      const hue    = hues[idx % hues.length];
      return { xi, di, distM, conf: det.confidence, hue };
    });

    // Sort back-to-front (painter's algorithm: far persons first)
    persons.sort((a, b) => b.di - a.di);

    for (const p of persons) {
      const { xi, di, distM, conf, hue } = p;

      // Person footprint width in grid cells (~0.5 m wide person)
      const personWidthCells = 0.5 / (HFOV_DEG / XC) * (1 - di / DC * 0.4);

      const tl = project(xi - personWidthCells / 2, di + 0.8);
      const tr = project(xi + personWidthCells / 2, di + 0.8);
      const br = project(xi + personWidthCells / 2, di);
      const bl = project(xi - personWidthCells / 2, di);

      // Perspective height — taller when near, smaller when far
      const perspScale = 1 - (di / DC) * 0.55;
      const pillarH    = H * 0.28 * perspScale * Math.min(conf + 0.3, 1.0);

      const topTl = { x: tl.x, y: tl.y - pillarH };
      const topTr = { x: tr.x, y: tr.y - pillarH };
      const topBr = { x: br.x, y: br.y - pillarH };
      const topBl = { x: bl.x, y: bl.y - pillarH };

      const baseColor = `hsl(${hue}, 100%, 55%)`;
      const topColor  = `hsl(${hue}, 100%, 80%)`;
      const rimColor  = `hsl(${hue}, 100%, 92%)`;

      // Floor shadow / glow ring
      const cxFloor = (bl.x + br.x) / 2;
      const cyFloor = (bl.y + br.y) / 2;
      const glowR   = Math.abs(br.x - bl.x) * 1.4;
      const floorGlow = ctx.createRadialGradient(cxFloor, cyFloor, 0, cxFloor, cyFloor, glowR);
      floorGlow.addColorStop(0,   `hsla(${hue},100%,60%,0.35)`);
      floorGlow.addColorStop(0.5, `hsla(${hue},100%,50%,0.12)`);
      floorGlow.addColorStop(1,   `hsla(${hue},100%,40%,0.00)`);
      ctx.fillStyle = floorGlow;
      ctx.beginPath();
      ctx.ellipse(cxFloor, cyFloor, glowR, glowR * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floor tile
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue},100%,45%,0.55)`;
      ctx.fill();

      // Left face
      ctx.beginPath();
      ctx.moveTo(bl.x, bl.y); ctx.lineTo(topBl.x, topBl.y);
      ctx.lineTo(topTl.x, topTl.y); ctx.lineTo(tl.x, tl.y);
      ctx.closePath();
      const lfg = ctx.createLinearGradient(0, bl.y, 0, topBl.y);
      lfg.addColorStop(0, `hsla(${hue},100%,40%,0.85)`);
      lfg.addColorStop(1, `hsla(${hue},100%,65%,0.30)`);
      ctx.fillStyle = lfg;
      ctx.fill();

      // Right face
      ctx.beginPath();
      ctx.moveTo(br.x, br.y); ctx.lineTo(topBr.x, topBr.y);
      ctx.lineTo(topTr.x, topTr.y); ctx.lineTo(tr.x, tr.y);
      ctx.closePath();
      const rfg = ctx.createLinearGradient(0, br.y, 0, topBr.y);
      rfg.addColorStop(0, `hsla(${hue},100%,35%,0.70)`);
      rfg.addColorStop(1, `hsla(${hue},100%,55%,0.22)`);
      ctx.fillStyle = rfg;
      ctx.fill();

      // Top face with brightest colour
      ctx.beginPath();
      ctx.moveTo(topTl.x, topTl.y); ctx.lineTo(topTr.x, topTr.y);
      ctx.lineTo(topBr.x, topBr.y); ctx.lineTo(topBl.x, topBl.y);
      ctx.closePath();
      ctx.fillStyle = topColor;
      ctx.fill();

      // Edge rim on top face
      ctx.beginPath();
      ctx.moveTo(topTl.x, topTl.y); ctx.lineTo(topTr.x, topTr.y);
      ctx.lineTo(topBr.x, topBr.y); ctx.lineTo(topBl.x, topBl.y);
      ctx.closePath();
      ctx.strokeStyle = rimColor;
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Glow above top face
      const cxTop = (topTl.x + topTr.x + topBr.x + topBl.x) / 4;
      const cyTop = (topTl.y + topTr.y + topBr.y + topBl.y) / 4;
      ctx.save();
      ctx.shadowBlur  = 28;
      ctx.shadowColor = baseColor;
      ctx.fillStyle   = rimColor;
      ctx.beginPath(); ctx.arc(cxTop, cyTop, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Distance label floating above pillar
      ctx.font      = `bold ${Math.max(9, 12 - di / DC * 4)}px system-ui`;
      ctx.fillStyle = rimColor;
      ctx.textAlign = 'center';
      ctx.shadowBlur  = 6;
      ctx.shadowColor = baseColor;
      ctx.fillText(`${distM.toFixed(1)}m`, cxTop, topTl.y - 6);
      ctx.shadowBlur = 0;
    }

    // Live badge top-left
    ctx.fillStyle = 'rgba(255,60,60,0.85)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 58, 22, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`● LIVE  ${detections.length}`, 18, 25);

    this.drawColorScaleHSL(ctx, W, H);
  }

  // ── 2D Bird's-Eye View ───────────────────────────────────────────────

  private drawBirdsEye(data: SpatialHeatmapData) {
    const canvas = this.beCanvas?.nativeElement;
    if (!canvas) return;
    const W = canvas.width  = canvas.offsetWidth  || 640;
    const H = canvas.height = canvas.offsetHeight || 420;
    const ctx = canvas.getContext('2d')!;
    const { xCells: XC, depthCells: DC, maxDepthM, hfovDeg } = data;

    const rawGrid = new Float32Array(DC * XC);
    for (const p of data.points) rawGrid[p.di * XC + p.xi] = p.value;
    const smoothed = this.normalise(this.gaussianSmooth(rawGrid, DC, XC, 2.5));

    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, W, H);

    const camX = W / 2;
    const halfAngle = (hfovDeg / 2) * Math.PI / 180;
    const fovLen = H * 1.15;
    const coneGrad = ctx.createRadialGradient(camX, H, 0, camX, H, fovLen);
    coneGrad.addColorStop(0,   'rgba(0,120,160,0.22)');
    coneGrad.addColorStop(0.6, 'rgba(0,60,100,0.08)');
    coneGrad.addColorStop(1,   'rgba(0,20,40,0.00)');
    ctx.beginPath();
    ctx.moveTo(camX, H);
    ctx.lineTo(camX - Math.sin(halfAngle) * fovLen, H - Math.cos(halfAngle) * fovLen);
    ctx.lineTo(camX + Math.sin(halfAngle) * fovLen, H - Math.cos(halfAngle) * fovLen);
    ctx.closePath();
    ctx.fillStyle = coneGrad;
    ctx.fill();

    const imageData = ctx.createImageData(W, H);
    const px = imageData.data;
    for (let py = 0; py < H; py++) {
      const di_f = ((H - py) / H) * DC;
      for (let qx = 0; qx < W; qx++) {
        const xi_f = (qx / W) * XC;
        const xi0 = Math.floor(xi_f), xi1 = Math.min(xi0 + 1, XC - 1);
        const di0 = Math.floor(di_f), di1 = Math.min(di0 + 1, DC - 1);
        const fx = xi_f - xi0, fd = di_f - di0;
        const v =
          (1 - fd) * ((1 - fx) * (smoothed[di0 * XC + xi0] || 0) + fx * (smoothed[di0 * XC + xi1] || 0)) +
          fd       * ((1 - fx) * (smoothed[di1 * XC + xi0] || 0) + fx * (smoothed[di1 * XC + xi1] || 0));
        const [r, g, b, a] = this.heatRGBA(v, 215);
        const idx = (py * W + qx) * 4;
        px[idx] = r; px[idx+1] = g; px[idx+2] = b; px[idx+3] = a;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    ctx.save();
    for (let d = 1; d <= maxDepthM; d++) {
      const y = H - (d / maxDepthM) * H;
      const major = d % 2 === 0;
      ctx.strokeStyle = major ? 'rgba(0,200,255,0.30)' : 'rgba(0,200,255,0.10)';
      ctx.lineWidth   = major ? 1.0 : 0.5;
      ctx.setLineDash(major ? [] : [3, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      if (major) {
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,210,255,0.75)';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`${d}m`, 8, y - 4);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(0,229,255,0.6)';
    ctx.strokeStyle = 'rgba(0,229,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(camX, H);
    ctx.lineTo(camX - Math.sin(halfAngle) * fovLen, H - Math.cos(halfAngle) * fovLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(camX, H);
    ctx.lineTo(camX + Math.sin(halfAngle) * fovLen, H - Math.cos(halfAngle) * fovLen);
    ctx.stroke();
    ctx.restore();

    ctx.shadowBlur = 14; ctx.shadowColor = '#00e5ff';
    ctx.fillStyle  = '#00e5ff';
    ctx.beginPath(); ctx.arc(camX, H - 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,210,255,0.55)';
    ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('CAM', camX, H - 18);

    const edgeX = Math.sin(halfAngle) * 55;
    ctx.textAlign = 'right';
    ctx.fillText(`-${(hfovDeg / 2).toFixed(0)}°`, camX - edgeX - 4, H - 26);
    ctx.textAlign = 'left';
    ctx.fillText(`+${(hfovDeg / 2).toFixed(0)}°`, camX + edgeX + 4, H - 26);

    this.drawColorScale(ctx, W, H);
  }

  // ── 3D Perspective (Historical) ──────────────────────────────────────

  private drawPerspective(data: SpatialHeatmapData) {
    const canvas = this.p3Canvas?.nativeElement;
    if (!canvas) return;
    const W = canvas.width  = canvas.offsetWidth  || 640;
    const H = canvas.height = canvas.offsetHeight || 420;
    const ctx = canvas.getContext('2d')!;
    const { xCells: XC, depthCells: DC, maxDepthM } = data;

    const rawGrid = new Float32Array(DC * XC);
    for (const p of data.points) rawGrid[p.di * XC + p.xi] = p.value;
    const smoothed = this.normalise(this.gaussianSmooth(rawGrid, DC, XC, 2.0));

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05070f'); bg.addColorStop(1, '#0a0e1e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const project = this.makeProjector(W, H, XC, DC);
    this.drawFloorGrid(ctx, W, H, XC, DC, project);

    for (let di = DC - 1; di >= 0; di--) {
      for (let xi = 0; xi < XC; xi++) {
        const v  = smoothed[di * XC + xi];
        const tl = project(xi,     di + 1);
        const tr = project(xi + 1, di + 1);
        const br = project(xi + 1, di);
        const bl = project(xi,     di);

        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        if (v > 0.02) {
          const [r, g, b, a] = this.heatRGBA(v, 200);
          const tg = ctx.createLinearGradient(0, bl.y, 0, tl.y);
          tg.addColorStop(0, `rgba(${r},${g},${b},${a/255})`);
          tg.addColorStop(1, `rgba(${r},${g},${b},${(a*.45)/255})`);
          ctx.fillStyle = tg;
        } else { ctx.fillStyle = 'rgba(8,12,24,0.35)'; }
        ctx.fill();

        if (v > 0.10) {
          const pScale = 1 - (di / DC) * 0.55;
          const barH   = v * H * 0.30 * pScale;
          const [r, g, b] = this.heatRGBA(v);
          const topTl = { x: tl.x, y: tl.y - barH };
          const topTr = { x: tr.x, y: tr.y - barH };
          const topBr = { x: br.x, y: br.y - barH };
          const topBl = { x: bl.x, y: bl.y - barH };

          const drawFace = (pts: {x:number,y:number}[], g0: string, g1: string, gy0: number, gy1: number) => {
            const lg = ctx.createLinearGradient(0, gy0, 0, gy1);
            lg.addColorStop(0, g0); lg.addColorStop(1, g1);
            ctx.beginPath();
            pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.closePath(); ctx.fillStyle = lg; ctx.fill();
          };

          drawFace([bl, topBl, topTl, tl],
            `rgba(${r},${g},${b},0.75)`, `rgba(${r},${g},${b},0.25)`, bl.y, topBl.y);
          drawFace([br, topBr, topTr, tr],
            `rgba(${r},${g},${b},0.55)`, `rgba(${r},${g},${b},0.18)`, br.y, topBr.y);

          const tr_ = Math.min(255,r+50), tg_ = Math.min(255,g+50), tb_ = Math.min(255,b+50);
          ctx.beginPath();
          ctx.moveTo(topTl.x,topTl.y); ctx.lineTo(topTr.x,topTr.y);
          ctx.lineTo(topBr.x,topBr.y); ctx.lineTo(topBl.x,topBl.y);
          ctx.closePath(); ctx.fillStyle = `rgba(${tr_},${tg_},${tb_},0.92)`; ctx.fill();

          if (v > 0.6) {
            const cx_ = (topTl.x+topTr.x+topBr.x+topBl.x)/4;
            const cy_ = (topTl.y+topTr.y+topBr.y+topBl.y)/4;
            ctx.save();
            ctx.shadowBlur = 22; ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
            ctx.fillStyle = `rgba(${tr_},${tg_},${tb_},1)`;
            ctx.beginPath(); ctx.arc(cx_, cy_, 2, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          }
        }
      }
    }

    ctx.font = 'bold 11px system-ui'; ctx.fillStyle = 'rgba(0,200,255,0.55)';
    ctx.textAlign = 'right';
    for (let d = 2; d <= maxDepthM; d += 2) {
      const di = Math.round((d / maxDepthM) * DC);
      const pt = project(0, di);
      ctx.fillText(`${d}m`, pt.x - 5, pt.y + 4);
    }

    const cam = project(XC / 2, 0);
    ctx.save();
    ctx.shadowBlur = 16; ctx.shadowColor = '#00e5ff';
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath(); ctx.arc(cam.x, cam.y + 12, 6, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,229,255,0.6)'; ctx.textAlign = 'center';
    ctx.font = '10px system-ui';
    ctx.fillText('CAM', cam.x, cam.y + 26);

    this.drawColorScale(ctx, W, H);
  }

  // ── Color-scale legends ──────────────────────────────────────────────

  private drawColorScale(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const sw = 12, sh = 110, sx = W - 30, sy = H - sh - 36;
    const grad = ctx.createLinearGradient(0, sy + sh, 0, sy);
    grad.addColorStop(0.00, 'rgba(0,0,90,0.9)');
    grad.addColorStop(0.12, 'rgba(0,0,220,0.9)');
    grad.addColorStop(0.28, 'rgba(0,130,255,0.9)');
    grad.addColorStop(0.44, 'rgba(0,230,200,0.9)');
    grad.addColorStop(0.58, 'rgba(80,255,0,0.9)');
    grad.addColorStop(0.70, 'rgba(220,230,0,0.9)');
    grad.addColorStop(0.82, 'rgba(255,100,0,0.9)');
    grad.addColorStop(1.00, 'rgba(255,0,0,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.font = '9px system-ui'; ctx.fillStyle = 'rgba(200,220,255,0.72)';
    ctx.textAlign = 'right';
    ctx.fillText('High', sx - 3, sy + 9);
    ctx.fillText('Mid',  sx - 3, sy + sh / 2 + 4);
    ctx.fillText('Low',  sx - 3, sy + sh);
  }

  private drawColorScaleHSL(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const sw = 12, sh = 80, sx = W - 30, sy = H - sh - 36;
    const hues = [180, 140, 60, 320, 270, 30, 200];
    const sh_each = sh / hues.length;
    hues.forEach((hue, i) => {
      ctx.fillStyle = `hsl(${hue},100%,55%)`;
      ctx.fillRect(sx, sy + i * sh_each, sw, sh_each + 1);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.font = '9px system-ui'; ctx.fillStyle = 'rgba(200,220,255,0.72)';
    ctx.textAlign = 'right';
    ctx.fillText('Person 1', sx - 3, sy + 10);
    ctx.fillText('…',        sx - 3, sy + sh / 2 + 4);
  }

  private loadScript(): Promise<void> {
    return new Promise(resolve => {
      if ((window as any).h337) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js';
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
  }
}
