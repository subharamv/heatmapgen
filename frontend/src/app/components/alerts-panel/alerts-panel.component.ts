import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertService } from '../../services/alert.service';
import { Alert } from '../../models/zone.model';

@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alerts-panel.component.html',
  styleUrls: ['./alerts-panel.component.scss'],
})
export class AlertsPanelComponent implements OnInit {
  alerts: Alert[] = [];

  constructor(private alertSvc: AlertService) {}

  ngOnInit() {
    this.alertSvc.alerts$.subscribe(a => (this.alerts = a));
  }

  clearAlerts() {
    this.alertSvc.alerts$.next([]);
  }

  getZoneName(a: Alert): string {
    return a.zone_name ?? a.zoneName ?? 'Unknown Zone';
  }

  getLimit(a: Alert): number {
    return a.limit_val ?? a.limit ?? 0;
  }

  getTimestamp(a: Alert): string {
    return a.triggered_at ?? a.timestamp ?? new Date().toISOString();
  }

  formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString();
  }
}
