import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SocketService } from '../../services/socket.service';
import { ZoneService } from '../../services/zone.service';
import { AlertService } from '../../services/alert.service';
import { CountUpdate, Zone } from '../../models/zone.model';
import { CameraFeedComponent } from '../camera-feed/camera-feed.component';
import { ZoneManagerComponent } from '../zone-manager/zone-manager.component';
import { HeatmapComponent } from '../heatmap/heatmap.component';
import { AlertsPanelComponent } from '../alerts-panel/alerts-panel.component';
import { CameraSettingsComponent } from '../camera-settings/camera-settings.component';
import { ViolationForPipe, MinPipe } from '../../pipes/violation-for.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    CameraFeedComponent,
    ZoneManagerComponent,
    HeatmapComponent,
    AlertsPanelComponent,
    CameraSettingsComponent,
    ViolationForPipe,
    MinPipe,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  connected = false;
  countUpdate: CountUpdate | null = null;
  zones: Zone[] = [];
  drawMode = false;
  pendingPolygon: [number, number][] | null = null;
  activeTab: 'live' | 'heatmap' = 'live';
  alertCount = 0;

  private subs = new Subscription();

  constructor(
    private socket: SocketService,
    private zoneSvc: ZoneService,
    private alertSvc: AlertService,
  ) {}

  ngOnInit() {
    this.subs.add(this.socket.connected$.subscribe(v => (this.connected = v)));
    this.subs.add(this.socket.countUpdate$.subscribe(u => (this.countUpdate = u)));
    this.subs.add(this.zoneSvc.zones$.subscribe(z => (this.zones = z)));
    this.subs.add(this.alertSvc.alerts$.subscribe(a => (this.alertCount = a.length)));
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  onDrawModeChange(mode: boolean) {
    this.drawMode = mode;
  }

  onPolygonDrawn(polygon: [number, number][]) {
    this.pendingPolygon = polygon;
    this.drawMode = false;
  }

  onZonesChanged(zones: Zone[]) {
    this.zones = zones;
  }

  get totalCount() { return this.countUpdate?.totalCount ?? 0; }
  get hasViolations() { return (this.countUpdate?.violations?.length ?? 0) > 0; }
}
