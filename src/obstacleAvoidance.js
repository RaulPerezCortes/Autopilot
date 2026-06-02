export const DEFAULT_OBSTACLE_THRESHOLD_CM = 30;
export const SEND_INTERVAL_MS = 50;

const DT = SEND_INTERVAL_MS / 1000;
const TURN_RATE = 2.5;
const SPEED = 0.5;

const AVOID_REVERSE_STEPS = 8;
const AVOID_TURN_STEPS = 16;
const AVOID_FORWARD_STEPS = 24;
const AVOID_RETURN_STEPS = 16;
const REJOIN_TRANSITION_STEPS = 20;

export function parseUltrasonicMessage(line, thresholdCm = DEFAULT_OBSTACLE_THRESHOLD_CM) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const threshold = normalizeThreshold(thresholdCm);
  const distanceMatch = trimmed.match(/^D:(\d+(?:\.\d+)?)$/i);

  if (distanceMatch) {
    const distance = Number(distanceMatch[1]);
    if (!Number.isFinite(distance)) return null;

    return {
      obstacle: distance <= threshold,
      distance,
    };
  }

  const upper = trimmed.toUpperCase();

  if (upper === "OBSTACLE" || upper === "OBSTACLE:1" || upper.startsWith("OBSTACLE:NEAR")) {
    return { obstacle: true };
  }

  if (upper === "OBSTACLE:0" || upper === "CLEAR") {
    return { obstacle: false };
  }

  const legacyMatch = upper.match(/^(?:US|SONAR|ULTRASONIC)[:\s]+(\d+(?:\.\d+)?)/);
  if (legacyMatch) {
    const distance = Number(legacyMatch[1]);
    if (!Number.isFinite(distance)) return null;

    return {
      obstacle: distance <= threshold,
      distance,
    };
  }

  return null;
}

function normalizeThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) return DEFAULT_OBSTACLE_THRESHOLD_CM;
  return Math.max(5, Math.min(300, Math.round(threshold)));
}

export function integrateRecording(frames) {
  const poses = [{ x: 0, y: 0, heading: 0 }];
  let pose = { x: 0, y: 0, heading: 0 };

  for (const frame of frames) {
    pose = advancePose(pose, frame);
    poses.push({ ...pose });
  }

  return poses;
}

export function advancePose(pose, frame) {
  const next = {
    x: pose.x,
    y: pose.y,
    heading: pose.heading + frame.x * TURN_RATE * DT,
  };

  next.x += frame.y * Math.sin(next.heading) * SPEED * DT;
  next.y += frame.y * Math.cos(next.heading) * SPEED * DT;

  return next;
}

export function buildAvoidanceManeuver(currentFrame) {
  const frames = [];
  const movingForward = (currentFrame?.y ?? 0) >= 0;

  if (movingForward) {
    pushRepeated(frames, { x: 0, y: -0.45 }, AVOID_REVERSE_STEPS);
  }

  pushRepeated(frames, { x: 0.85, y: 0.25 }, AVOID_TURN_STEPS);
  pushRepeated(frames, { x: 0, y: 0.75 }, AVOID_FORWARD_STEPS);
  pushRepeated(frames, { x: -0.85, y: 0.25 }, AVOID_RETURN_STEPS);

  return frames;
}

export function buildRejoinPlan(currentPose, originalFrames, minIndex) {
  const path = integrateRecording(originalFrames);
  const rejoinIndex = findRejoinIndex(currentPose, path, minIndex);
  const targetFrame = originalFrames[rejoinIndex] ?? { x: 0, y: 0 };
  const targetPoint = path[rejoinIndex];
  const dx = targetPoint.x - currentPose.x;
  const dy = targetPoint.y - currentPose.y;
  let headingToTarget = Math.atan2(dx, dy);
  let headingError = headingToTarget - currentPose.heading;

  while (headingError > Math.PI) headingError -= Math.PI * 2;
  while (headingError < -Math.PI) headingError += Math.PI * 2;

  const steerCommand = clamp(headingError * 1.2);
  const forwardCommand = clamp(Math.min(0.8, Math.hypot(dx, dy) * 2));
  const transition = [];

  for (let step = 1; step <= REJOIN_TRANSITION_STEPS; step += 1) {
    const t = step / REJOIN_TRANSITION_STEPS;
    transition.push({
      x: roundAxis(lerp(steerCommand, targetFrame.x, t)),
      y: roundAxis(lerp(forwardCommand, targetFrame.y, t)),
    });
  }

  return {
    transitionFrames: transition,
    rejoinIndex,
  };
}

function findRejoinIndex(pose, path, minIndex) {
  const startIndex = Math.max(minIndex, 1);
  let bestIndex = Math.min(startIndex + 10, path.length - 1);
  let bestDistance = distanceBetween(pose, path[bestIndex]);

  for (let index = startIndex; index < path.length; index += 1) {
    const pathDistance = distanceBetween(pose, path[index]);
    if (pathDistance < bestDistance) {
      bestDistance = pathDistance;
      bestIndex = index;
    }
  }

  return Math.max(bestIndex, Math.min(startIndex + 10, path.length - 1));
}

function pushRepeated(frames, frame, count) {
  for (let index = 0; index < count; index += 1) {
    frames.push({ x: frame.x, y: frame.y });
  }
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

function roundAxis(value) {
  return Number(value.toFixed(2));
}
