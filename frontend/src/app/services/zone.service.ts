import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Zone, HeatmapData, SpatialHeatmapData } from '../models/zone.model';

const API = 'http://localhost:3000/api';
const DETECTION = '/detection-api';

@Injectable({ providedIn: 'root' })
export class ZoneService {
  zones$ = new BehaviorSubject<Zone[]>([]);

  constructor(private http: HttpClient) {}

  loadZones(): Observable<Zone[]> {
    return this.http.get<Zone[]>(`${API}/zones`).pipe(
      tap(zones => {
        this.zones$.next(zones);
        this.syncToDetection(zones);
      })
    );
  }

  createZone(zone: Omit<Zone, 'id' | 'createdAt'>): Observable<Zone> {
    return this.http.post<Zone>(`${API}/zones`, zone).pipe(
      tap(() => this.loadZones().subscribe())
    );
  }

  updateZone(id: string, zone: Partial<Zone>): Observable<Zone> {
    return this.http.put<Zone>(`${API}/zones/${id}`, zone).pipe(
      tap(() => this.loadZones().subscribe())
    );
  }

  deleteZone(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/zones/${id}`).pipe(
      tap(() => this.loadZones().subscribe())
    );
  }

  getHeatmap(): Observable<HeatmapData> {
    return this.http.get<HeatmapData>(`${DETECTION}/heatmap`);
  }

  resetHeatmap(): Observable<void> {
    return this.http.post<void>(`${DETECTION}/heatmap/reset`, {});
  }

  getSpatialHeatmap(): Observable<SpatialHeatmapData> {
    return this.http.get<SpatialHeatmapData>(`${DETECTION}/heatmap/spatial`);
  }

  private syncToDetection(zones: Zone[]) {
    this.http.post(`${DETECTION}/zones`, { zones }).subscribe({ error: () => {} });
  }
}
