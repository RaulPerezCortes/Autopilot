export const DEFAULT_OBSTACLE_THRESHOLD_CM = 30;
export const SEND_INTERVAL_MS = 50;

export function parseUltrasonicMessage(line, thresholdCm = DEFAULT_OBSTACLE_THRESHOLD_CM) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const distanceMatch = trimmed.match(/^D:(\d+(?:\.\d+)?)$/i);
  if (distanceMatch) {
    const distance = Number(distanceMatch[1]);
    if (!Number.isFinite(distance)) return null;
    return { obstacle: distance <= thresholdCm, distance };
  }

  const upper = trimmed.toUpperCase();
  if (upper === "OBSTACLE" || upper === "OBSTACLE:1" || upper.startsWith("OBSTACLE:NEAR")) {
    return { obstacle: true };
  }
  if (upper === "OBSTACLE:0" || upper === "CLEAR") {
    return { obstacle: false };
  }

  return null;
}