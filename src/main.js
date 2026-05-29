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
};

let currentPosition = { x: 0, y: 0 };
let lastSentPosition = { x: 0, y: 0 };
let lastSentCommand = "";
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

sendTimer = window.setInterval(async () => {
  const robot = getActiveRobot();
  if (!robot.isConnected) return;

  try {
    const sent = elements.sendMode.value === "letters"
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
  if (positionsAreEqual(currentPosition, lastSentPosition)) return false;
  return getActiveRobot().sendCoordinates(currentPosition);
}

async function sendLetterCommand() {
  const command = positionToCommand(currentPosition);
  if (command === lastSentCommand) return false;
  return getActiveRobot().sendCommand(command);
}

function updateLastSentValue() {
  if (elements.sendMode.value === "letters") {
    lastSentCommand = positionToCommand(currentPosition);
    return;
  }

  lastSentPosition = { ...currentPosition };
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
    : "BLE UART listo: conecta un dispositivo compatible con Nordic UART.");
}

function getConnectButtonLabel(state) {
  const transportLabel = elements.connectionMode.value === "serial" ? "Serial HC-05" : "Bluetooth BLE";

  if (state === "connected") return `Desconectar ${transportLabel}`;
  if (state === "connecting") return `Conectando ${transportLabel}`;
  return `Conectar ${transportLabel}`;
}
