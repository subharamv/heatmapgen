import { Pipe, PipeTransform } from '@angular/core';
import { Violation } from '../models/zone.model';

@Pipe({ name: 'violationFor', standalone: true })
export class ViolationForPipe implements PipeTransform {
  transform(violations: Violation[] | undefined, zoneId: string): boolean {
    return (violations ?? []).some(v => v.zoneId === zoneId);
  }
}

@Pipe({ name: 'min', standalone: true })
export class MinPipe implements PipeTransform {
  transform(value: number, cap: number): number {
    return Math.min(value, cap);
  }
}
