import type { GeoJsonArea, GeoPosition, PolygonRings } from '../contract/geo';

const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LON_AT_EQUATOR = 111_320;

/** Ray-casting. Halqa yopiq bo'lishi shart emas. */
export function pointInRing(lon: number, lat: number, ring: readonly GeoPosition[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Tashqi halqa ichida va hech bir teshik ichida bo'lmasa — `true`. */
export function pointInPolygon(lon: number, lat: number, rings: PolygonRings): boolean {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 3) return false;
  if (!pointInRing(lon, lat, outer)) return false;
  return !holes.some((hole) => pointInRing(lon, lat, hole));
}

export function pointInArea(lon: number, lat: number, area: GeoJsonArea): boolean {
  if (area.type === 'Polygon') return pointInPolygon(lon, lat, area.coordinates);
  return area.coordinates.some((rings) => pointInPolygon(lon, lat, rings));
}

/** Nuqtaga nisbatan lokal tekis koordinata (metr). Kichik masofalarda yetarli aniq. */
function toLocalMeters(lon: number, lat: number, lon0: number, lat0: number): [number, number] {
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return [(lon - lon0) * METERS_PER_DEG_LON_AT_EQUATOR * cos, (lat - lat0) * METERS_PER_DEG_LAT];
}

function distanceToSegmentM(
  lon: number,
  lat: number,
  a: GeoPosition,
  b: GeoPosition,
): number {
  const [ax, ay] = toLocalMeters(a[0], a[1], lon, lat);
  const [bx, by] = toLocalMeters(b[0], b[1], lon, lat);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax, ay);
  // Nuqta (0,0) bo'lgani uchun proyeksiya soddalashadi.
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function ringDistanceM(lon: number, lat: number, ring: readonly GeoPosition[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = distanceToSegmentM(lon, lat, ring[j]!, ring[i]!);
    if (d < min) min = d;
  }
  return min;
}

/** Chegaraga eng qisqa masofa (metr), ishorasiz. */
export function distanceToBoundaryM(lon: number, lat: number, area: GeoJsonArea): number {
  const polygons = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  let min = Number.POSITIVE_INFINITY;
  for (const rings of polygons) {
    for (const ring of rings) {
      if (ring.length < 2) continue;
      const d = ringDistanceM(lon, lat, ring);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Ishorali masofa: ichkarida musbat, tashqarida manfiy.
 * Aniqlik radiusi bilan taqqoslash uchun aynan shu qiymat ishlatiladi.
 */
export function signedDistanceToBoundaryM(lon: number, lat: number, area: GeoJsonArea): number {
  const d = distanceToBoundaryM(lon, lat, area);
  return pointInArea(lon, lat, area) ? d : -d;
}

export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // (0,0) — emulyator/xatolik belgisi, qabul qilinmaydi.
    !(lat === 0 && lon === 0)
  );
}

/** Xarita ko'rinishi uchun oddiy bounding box. */
export function areaBounds(area: GeoJsonArea): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  const polygons = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}
