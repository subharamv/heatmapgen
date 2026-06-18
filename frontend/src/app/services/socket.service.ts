import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { CountUpdate, Alert } from '../models/zone.model';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket;

  countUpdate$ = new Subject<CountUpdate>();
  alert$ = new Subject<Alert>();
  connected$ = new Subject<boolean>();

  constructor(private zone: NgZone) {
    this.socket = io('http://localhost:3000', { transports: ['websocket'] });

    this.socket.on('connect', () => this.zone.run(() => this.connected$.next(true)));
    this.socket.on('disconnect', () => this.zone.run(() => this.connected$.next(false)));
    this.socket.on('count_update', (data: CountUpdate) => this.zone.run(() => this.countUpdate$.next(data)));
    this.socket.on('alert', (data: Alert) => this.zone.run(() => this.alert$.next(data)));
  }

  ngOnDestroy() {
    this.socket.disconnect();
  }
}
