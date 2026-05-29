const ZERO_POSITION = { x: 0, y: 0 };

export class JoystickController {
  constructor({ baseElement, knobElement, onMove }) {
    this.baseElement = baseElement;
    this.knobElement = knobElement;
    this.onMove = onMove;
    this.position = { ...ZERO_POSITION };
    this.activePointerId = null;
    this.frameRequest = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
  }

  init() {
    this.baseElement.addEventListener("pointerdown", this.handlePointerDown);
    this.baseElement.addEventListener("pointermove", this.handlePointerMove);
    this.baseElement.addEventListener("pointerup", this.handlePointerUp);
    this.baseElement.addEventListener("pointercancel", this.handlePointerUp);
    this.baseElement.addEventListener("lostpointercapture", this.handlePointerUp);
    this.updateVisualPosition(ZERO_POSITION);
  }

  destroy() {
    this.baseElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.baseElement.removeEventListener("pointermove", this.handlePointerMove);
    this.baseElement.removeEventListener("pointerup", this.handlePointerUp);
    this.baseElement.removeEventListener("pointercancel", this.handlePointerUp);
    this.baseElement.removeEventListener("lostpointercapture", this.handlePointerUp);
  }

  handlePointerDown(event) {
    if (this.activePointerId !== null) return;

    this.activePointerId = event.pointerId;
    this.baseElement.setPointerCapture(event.pointerId);
    this.baseElement.classList.add("is-active");
    this.moveFromEvent(event);
  }

  handlePointerMove(event) {
    if (event.pointerId !== this.activePointerId) return;
    this.moveFromEvent(event);
  }

  handlePointerUp(event) {
    if (event.pointerId !== this.activePointerId) return;

    this.activePointerId = null;
    this.baseElement.classList.remove("is-active");
    this.position = { ...ZERO_POSITION };
    this.updateVisualPosition(this.position);
    this.onMove(this.position);
  }

  moveFromEvent(event) {
    event.preventDefault();

    const rect = this.baseElement.getBoundingClientRect();
    const radius = rect.width / 2;
    const centerX = rect.left + radius;
    const centerY = rect.top + radius;
    const knobRadius = this.knobElement.offsetWidth / 2;
    const maxDistance = radius - knobRadius;

    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const limitedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(rawY, rawX);

    const visualX = Math.cos(angle) * limitedDistance;
    const visualY = Math.sin(angle) * limitedDistance;
    const x = clamp(visualX / maxDistance);
    const y = clamp(-visualY / maxDistance);

    this.position = {
      x: roundAxis(x),
      y: roundAxis(y),
    };

    this.updateVisualPosition({ x: visualX, y: visualY }, true);
    this.onMove(this.position);
  }

  updateVisualPosition(position, pixelPosition = false) {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
    }

    this.frameRequest = requestAnimationFrame(() => {
      const x = pixelPosition ? position.x : 0;
      const y = pixelPosition ? position.y : 0;
      this.knobElement.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    });
  }

  getPosition() {
    return { ...this.position };
  }
}

function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

function roundAxis(value) {
  return Number(value.toFixed(2));
}
