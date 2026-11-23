/** Human-readable units for the HUD and for evidence output. */

/** Metres, at a scale a person can read: `8.4 mm`, `246.9 km`, `1.3 Mm`. */
export function formatMetres(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  if (metres === 0) return '0 m';

  const magnitude = Math.abs(metres);
  if (magnitude < 1e-3) return `${(metres * 1e6).toFixed(0)} µm`;
  if (magnitude < 1) return `${(metres * 1e3).toFixed(1)} mm`;
  if (magnitude < 1e3) return `${metres.toFixed(2)} m`;
  if (magnitude < 1e6) return `${(metres / 1e3).toFixed(1)} km`;
  if (magnitude < 1e9) return `${(metres / 1e6).toFixed(1)} Mm`;
  return `${(metres / 1e9).toFixed(1)} Gm`;
}