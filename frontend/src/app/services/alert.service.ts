import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { Alert } from '../models/zone.model';
import { SocketService } from './socket.service';

@Injectable({ providedIn: 'root' })
export class AlertService {
  alerts$ = new BehaviorSubject<Alert[]>([]);

  constructor(private http: HttpClient, private socket: SocketService) {
    this.loadAlerts();
    this.socket.alert$.subscribe(alert => {
      const current = this.alerts$.value;
      this.alerts$.next([alert as any, ...current].slice(0, 100));
      this.playBeep();
    });
  }

  loadAlerts() {
    this.http.get<Alert[]>('http://localhost:3000/api/alerts').subscribe(
      alerts => this.alerts$.next(alerts)
    );
  }

  private playBeep() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }
}
