import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Zone } from '../../models/zone.model';
import { ZoneService } from '../../services/zone.service';

@Component({
  selector: 'app-zone-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './zone-manager.component.html',
  styleUrls: ['./zone-manager.component.scss'],
})
export class ZoneManagerComponent implements OnInit {
  @Input() pendingPolygon: [number, number][] | null = null;
  @Output() drawModeChange = new EventEmitter<boolean>();
  @Output() zonesChanged = new EventEmitter<Zone[]>();

  zones: Zone[] = [];
  drawMode = false;
  newZoneName = '';
  newZoneCapacity = 10;
  saving = false;

  constructor(private zoneSvc: ZoneService) {}

  ngOnInit() {
    this.zoneSvc.zones$.subscribe(z => {
      this.zones = z;
      this.zonesChanged.emit(z);
    });
    this.zoneSvc.loadZones().subscribe();
  }

  toggleDraw() {
    this.drawMode = !this.drawMode;
    this.drawModeChange.emit(this.drawMode);
  }

  onPolygonReady(polygon: [number, number][]) {
    this.pendingPolygon = polygon;
    this.drawMode = false;
    this.drawModeChange.emit(false);
  }

  saveZone() {
    if (!this.pendingPolygon || !this.newZoneName.trim()) return;
    this.saving = true;
    this.zoneSvc.createZone({
      name: this.newZoneName.trim(),
      polygon: this.pendingPolygon,
      maxCapacity: this.newZoneCapacity,
    }).subscribe(() => {
      this.pendingPolygon = null;
      this.newZoneName = '';
      this.newZoneCapacity = 10;
      this.saving = false;
    });
  }

  discardPending() {
    this.pendingPolygon = null;
  }

  deleteZone(id: string) {
    this.zoneSvc.deleteZone(id).subscribe();
  }
}
