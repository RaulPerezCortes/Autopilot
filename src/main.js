import "./style.css";
import { BluetoothRobot } from "./bluetooth.js";
import { JoystickController } from "./joystick.js";

const SEND_INTERVAL_MS = 50;

const elements = {
  connectButton: document.querySelector("#connectButton"),
  connectionPill: document.querySelector("#connectionPill"),
  connectionState: document.querySelector("#connectionState"),
  messageLog: document.querySelector("#messageLog"),
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

elements.connectButton.addEventListener("click", async () => {
  if (bluetoothRobot.isConnected) {
    await bluetoothRobot.disconnect();
    return;
  }

  try {
    elements.connectButton.disabled = true;
    await bluetoothRobot.connect();
  } catch (error) {
    updateConnectionState("disconnected");
    updateLog(error.message || "No se pudo conectar por Bluetooth.");
  } finally {
    elements.connectButton.disabled = false;
  }
});

sendTimer = window.setInterval(async () => {
  if (!bluetoothRobot.isConnected) return;

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
  elements.connectButton.textContent = state === "connected" ? "Desconectar Bluetooth" : "Conectar Bluetooth";
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
  return bluetoothRobot.sendCoordinates(currentPosition);
}

async function sendLetterCommand() {
  const command = positionToCommand(currentPosition);
  if (command === lastSentCommand) return false;
  return bluetoothRobot.sendCommand(command);
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
