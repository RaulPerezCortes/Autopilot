import { BluetoothRobot, SerialRobot } from "./bluetooth.js";
import { JoystickController } from "./joystick.js";

const SEND_INTERVAL_MS = 50;

const elements = {
  connectButton: document.querySelector("#connectButton"),
  connectionPill: document.querySelector("#connectionPill"),
  connectionState: document.querySelector("#connectionState"),
  messageLog: document.querySelector("#messageLog"),
  connectionMode: document.querySelector("#connectionMode"),
  baudRate: document.querySelector("#baudRate"),
  sendMode: document.querySelector("#sendMode"),
  xValue: document.querySelector("#xValue"),
  yValue: document.querySelector("#yValue"),
  joystickBase: document.querySelector("#joystickBase"),
  joystickKnob: document.querySelector("#joystickKnob"),
  motorButtons: document.querySelectorAll("[data-command]"),
};

let currentPosition = { x: 0, y: 0 };
let lastSentPosition = { x: 0, y: 0 };
let lastSentCommand = "";
let heldMotorCommand = null;
let pendingStopCommand = false;
let sendTimer = null;

const bluetoothRobot = new BluetoothRobot({
  onConnectionChange: updateConnectionState,
  onLog: updateLog,
});

const serialRobot = new SerialRobot({
  onConnectionChange: updateConnectionState,
  onLog: updateLog,
  getBaudRate: () => Number(elements.baudRate.value),
});

const joystick = new JoystickController({
  baseElement: elements.joystickBase,
  knobElement: elements.joystickKnob,
  onMove(position) {
    currentPosition = position;
    updateTelemetry(position);
  },
});

joystick.init();
updateConnectionState("disconnected");
updateTelemetry(currentPosition);
updateConnectionMode();

elements.connectButton.addEventListener("click", async () => {
  const robot = getActiveRobot();

  if (robot.isConnected) {
    await robot.disconnect();
    return;
  }

  try {
    elements.connectButton.disabled = true;
    await robot.connect();
  } catch (error) {
    updateConnectionState("disconnected");
    updateLog(error.message || "No se pudo conectar con el robot.");
  } finally {
    elements.connectButton.disabled = false;
  }
});

elements.connectionMode.addEventListener("change", async () => {
  if (getInactiveRobot().isConnected) {
    await getInactiveRobot().disconnect();
  }

  updateConnectionState("disconnected");
  updateConnectionMode();
});

elements.motorButtons.forEach((button) => {
  button.addEventListener("pointerdown", handleMotorButtonDown);
  button.addEventListener("pointerup", handleMotorButtonUp);
  button.addEventListener("pointercancel", handleMotorButtonUp);
  button.addEventListener("lostpointercapture", handleMotorButtonUp);
});

sendTimer = window.setInterval(async () => {
  const robot = getActiveRobot();
  if (!robot.isConnected) return;

  try {
    const sent = heldMotorCommand !== null || pendingStopCommand || elements.sendMode.value === "letters"
      ? await sendLetterCommand()
      : await sendCoordinates();

    if (sent) {
      updateLastSentValue();
    }
  } catch (error) {
    updateLog(`Error enviando datos: ${error.message}`);
  }
}, SEND_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  window.clearInterval(sendTimer);
  if (getActiveRobot().isConnected) {
    getActiveRobot().disconnect();
  }
});

function updateConnectionState(state) {
  const labels = {
    connected: "Conectado",
    connecting: "Conectando",
    disconnected: "Desconectado",
  };

  elements.connectionPill.dataset.state = state;
  elements.connectionState.textContent = labels[state] || labels.disconnected;
  elements.connectButton.classList.toggle("is-connected", state === "connected");
  elements.connectionMode.disabled = state !== "disconnected";
  elements.baudRate.disabled = state !== "disconnected" || elements.connectionMode.value !== "serial";
  elements.connectButton.textContent = getConnectButtonLabel(state);
}

function updateTelemetry({ x, y }) {
  elements.xValue.textContent = x.toFixed(2);
  elements.yValue.textContent = y.toFixed(2);
}

function updateLog(message) {
  elements.messageLog.textContent = message;
}

function positionsAreEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

async function sendCoordinates() {
  return getActiveRobot().sendCoordinates(currentPosition);
}

async function sendLetterCommand() {
  const command = getCurrentLetterCommand();

  if (command === lastSentCommand && command === "S" && heldMotorCommand === null) return false;
  return getActiveRobot().sendCommand(command);
}

function updateLastSentValue() {
  if (heldMotorCommand !== null || pendingStopCommand || elements.sendMode.value === "letters") {
    lastSentCommand = getCurrentLetterCommand();
    pendingStopCommand = false;
    return;
  }

  lastSentPosition = { ...currentPosition };
}

function getCurrentLetterCommand() {
  if (pendingStopCommand) return "S";
  if (heldMotorCommand !== null) return heldMotorCommand;
  return positionToCommand(currentPosition);
}

function positionToCommand({ x, y }) {
  const deadZone = 0.25;

  if (Math.abs(x) < deadZone && Math.abs(y) < deadZone) return "S";
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? "F" : "B";
  return x > 0 ? "R" : "L";
}

function getActiveRobot() {
  return elements.connectionMode.value === "serial" ? serialRobot : bluetoothRobot;
}

function getInactiveRobot() {
  return elements.connectionMode.value === "serial" ? bluetoothRobot : serialRobot;
}

function updateConnectionMode() {
  const isSerial = elements.connectionMode.value === "serial";
  elements.baudRate.disabled = !isSerial;
  updateLog(isSerial
    ? "HC-05 listo: emparejalo en el sistema y selecciona su puerto serie."
    : "BLE UART listo: selecciona tu modulo y se probaran perfiles Nordic/HM-10 compatibles.");
}

function handleMotorButtonDown(event) {
  const button = event.currentTarget;

  event.preventDefault();
  button.setPointerCapture(event.pointerId);
  button.classList.add("is-pressed");
  heldMotorCommand = button.dataset.command;
  pendingStopCommand = false;
}

function handleMotorButtonUp(event) {
  const button = event.currentTarget;

  if (button.hasPointerCapture(event.pointerId)) {
    button.releasePointerCapture(event.pointerId);
  }

  button.classList.remove("is-pressed");

  if (heldMotorCommand === button.dataset.command) {
    heldMotorCommand = null;
    pendingStopCommand = true;
  }
}

function getConnectButtonLabel(state) {
  const transportLabel = elements.connectionMode.value === "serial" ? "Serial HC-05" : "Bluetooth BLE";

  if (state === "connected") return `Desconectar ${transportLabel}`;
  if (state === "connecting") return `Conectando ${transportLabel}`;
  return `Conectar ${transportLabel}`;
}
