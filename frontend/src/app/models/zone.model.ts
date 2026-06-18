export interface Zone {
  id: string;
  name: string;
  polygon: [number, number][];
  maxCapacity: number;
  createdAt?: string;
}

export interface ZoneCount {
  [zoneId: string]: number;
}

export interface Violation {
  zoneId: string;
  zoneName: string;
  count: number;
  limit: number;
}

export interface Detection {
  bbox: [number, number, number, number];
  centroid: [number, number];
  confidence: number;
  distance_m?: number;
}

export interface CountUpdate {
  totalCount: number;
  zoneCounts: ZoneCount;
  violations: Violation[];
  detections: Detection[];
  timestamp: string;
}

export interface Alert {
  id?: number;
  zone_id?: string;
  zoneId?: string;
  zone_name?: string;
  zoneName?: string;
  count: number;
  limit_val?: number;
  limit?: number;
  triggered_at?: string;
  timestamp?: string;
}

export interface HeatmapData {
  points: { x: number; y: number; value: number }[];
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  gridSize: number;
}

export interface SpatialPoint {
  xi: number;
  di: number;
  angle_deg: number;
  dist_m: number;
  value: number;
}

export interface SpatialHeatmapData {
  points: SpatialPoint[];
  xCells: number;
  depthCells: number;
  maxDepthM: number;
  hfovDeg: number;
}
