import { BluetoothRobot, SerialRobot } from "./bluetooth.js";
import { JoystickController } from "./joystick.js";
import {
  advancePose,
  buildAvoidanceManeuver,
  buildRejoinPlan,
  DEFAULT_OBSTACLE_THRESHOLD_CM,
  parseUltrasonicMessage,
} from "./obstacleAvoidance.js";

const SEND_INTERVAL_MS = 50;
const STORAGE_KEY = "robot.savedLocations";
const RECORDINGS_STORAGE_KEY = "robot.savedRecordings";
const OBSTACLE_THRESHOLD_STORAGE_KEY = "robot.obstacleThresholdCm";

const elements = {
  connectButton: document.querySelector("#connectButton"),
  connectionPill: document.querySelector("#connectionPill"),
  connectionState: document.querySelector("#connectionState"),
  messageLog: document.querySelector("#messageLog"),
  connectionMode: document.querySelector("#connectionMode"),
  baudRate: document.querySelector("#baudRate"),
  obstacleThresholdCm: document.querySelector("#obstacleThresholdCm"),
  xValue: document.querySelector("#xValue"),
  yValue: document.querySelector("#yValue"),
  manualModeButton: document.querySelector("#manualModeButton"),
  recordingsModeButton: document.querySelector("#recordingsModeButton"),
  locationsModeButton: document.querySelector("#locationsModeButton"),
  manualPanel: document.querySelector("#manualPanel"),
  recordingsPanel: document.querySelector("#recordingsPanel"),
  locationsPanel: document.querySelector("#locationsPanel"),
  recordingNameInput: document.querySelector("#recordingNameInput"),
  recordButton: document.querySelector("#recordButton"),
  clearRecordingsButton: document.querySelector("#clearRecordingsButton"),
  savedRecordingsList: document.querySelector("#savedRecordingsList"),
  stopPlaybackButton: document.querySelector("#stopPlaybackButton"),
  playbackProgress: document.querySelector("#playbackProgress"),
  playbackProgressName: document.querySelector("#playbackProgressName"),
  playbackStepValue: document.querySelector("#playbackStepValue"),
  gpsState: document.querySelector("#gpsState"),
  refreshLocationButton: document.querySelector("#refreshLocationButton"),
  latitudeValue: document.querySelector("#latitudeValue"),
  longitudeValue: document.querySelector("#longitudeValue"),
  accuracyValue: document.querySelector("#accuracyValue"),
  locationNameInput: document.querySelector("#locationNameInput"),
  saveLocationButton: document.querySelector("#saveLocationButton"),
  clearLocationsButton: document.querySelector("#clearLocationsButton"),
  savedLocationsList: document.querySelector("#savedLocationsList"),
  joystickBase: document.querySelector("#joystickBase"),
  joystickKnob: document.querySelector("#joystickKnob"),
};

let appMode = "manual";
let currentPosition = { x: 0, y: 0 };
let currentLocation = null;
let savedLocations = loadSavedLocations();
let savedRecordings = loadSavedRecordings();
let sendTimer = null;
let isRecording = false;
let recordingFrames = [];
let isPlayingBack = false;
let playbackFrames = [];
let playbackIndex = 0;
let playbackRecordingName = "";
let playbackOriginalFrames = [];
let playbackOriginalIndex = 0;
let playbackEstimatedPose = { x: 0, y: 0, heading: 0 };
let isAvoiding = false;
let injectedPlaybackFrames = [];
let lastObstacleTriggerAt = 0;
let avoidanceRejoinIndex = 0;
const OBSTACLE_COOLDOWN_MS = 800;

const bluetoothRobot = new BluetoothRobot({
  onConnectionChange: updateConnectionState,
  onLog: updateLog,
  onMessage: handleRobotMessage,
});

const serialRobot = new SerialRobot({
  onConnectionChange: updateConnectionState,
  onLog: updateLog,
  onMessage: handleRobotMessage,
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
loadObstacleThreshold();
updateConnectionState("disconnected");
updateTelemetry(currentPosition);
updateLocationReadout();
renderSavedLocations();
renderSavedRecordings();
updateConnectionMode();
setAppMode("manual");
updateRecordingControls();

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

elements.obstacleThresholdCm.addEventListener("change", () => {
  persistObstacleThreshold();
});

elements.obstacleThresholdCm.addEventListener("input", () => {
  persistObstacleThreshold();
});

elements.manualModeButton.addEventListener("click", () => setAppMode("manual"));

elements.recordingsModeButton.addEventListener("click", () => setAppMode("recordings"));

elements.locationsModeButton.addEventListener("click", () => {
  setAppMode("locations");
  if (!currentLocation) {
    void refreshCurrentLocation();
  }
});

elements.refreshLocationButton.addEventListener("click", () => {
  void refreshCurrentLocation();
});

elements.saveLocationButton.addEventListener("click", () => {
  saveCurrentLocation();
});

elements.clearLocationsButton.addEventListener("click", () => {
  if (savedLocations.length === 0) return;
  if (!window.confirm("Borrar todas las ubicaciones guardadas?")) return;

  savedLocations = [];
  persistSavedLocations();
  renderSavedLocations();
  updateLog("Ubicaciones guardadas borradas.");
});

elements.savedLocationsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const location = savedLocations.find((item) => item.id === button.dataset.id);
  if (!location) return;

  if (button.dataset.action === "go") {
    void sendDestination(location);
    return;
  }

  if (button.dataset.action === "delete") {
    savedLocations = savedLocations.filter((item) => item.id !== location.id);
    persistSavedLocations();
    renderSavedLocations();
    updateLog(`Ubicacion "${location.name}" eliminada.`);
  }
});

elements.recordButton.addEventListener("click", () => {
  if (isPlayingBack) return;

  if (isRecording) {
    stopRecording();
    return;
  }

  startRecording();
});

elements.clearRecordingsButton.addEventListener("click", () => {
  if (savedRecordings.length === 0) return;
  if (!window.confirm("Borrar todas las grabaciones guardadas?")) return;

  savedRecordings = [];
  persistSavedRecordings();
  renderSavedRecordings();
  updateLog("Grabaciones guardadas borradas.");
});

elements.stopPlaybackButton.addEventListener("click", () => {
  stopPlayback("Reproduccion detenida.");
});

elements.savedRecordingsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const recording = savedRecordings.find((item) => item.id === button.dataset.id);
  if (!recording) return;

  if (button.dataset.action === "play") {
    void startPlayback(recording);
    return;
  }

  if (button.dataset.action === "delete") {
    if (isPlayingBack && playbackRecordingName === recording.name) {
      stopPlayback();
    }

    savedRecordings = savedRecordings.filter((item) => item.id !== recording.id);
    persistSavedRecordings();
    renderSavedRecordings();
    updateLog(`Grabacion "${recording.name}" eliminada.`);
  }
});

sendTimer = window.setInterval(async () => {
  const robot = getActiveRobot();
  if (!robot.isConnected) return;

  let position = null;
  let shouldSend = false;

  if (isPlayingBack) {
    if (injectedPlaybackFrames.length > 0) {
      position = injectedPlaybackFrames.shift();
      shouldSend = true;
    } else if (playbackIndex >= playbackFrames.length) {
      stopPlayback(`Reproduccion "${playbackRecordingName}" finalizada.`);
      return;
    } else {
      position = playbackFrames[playbackIndex];
      playbackIndex += 1;
      playbackOriginalIndex += 1;
      shouldSend = true;
    }

    updateTelemetry(position);
    updatePlaybackProgress();
    playbackEstimatedPose = advancePose(playbackEstimatedPose, position);

    if (isAvoiding && injectedPlaybackFrames.length === 0) {
      finishAvoidance();
    }
  } else if (appMode === "manual") {
    position = currentPosition;
    shouldSend = true;

    if (isRecording) {
      recordingFrames.push({ x: position.x, y: position.y });
    }
  }

  if (!shouldSend) return;

  try {
    await getActiveRobot().sendCoordinates(position);
  } catch (error) {
    updateLog(`Error enviando datos: ${error.message}`);
    if (isPlayingBack) {
      stopPlayback("Reproduccion interrumpida por error de envio.");
    }
  }
}, SEND_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  window.clearInterval(sendTimer);
  stopPlayback();
  stopRecording(false);
  if (getActiveRobot().isConnected) {
    getActiveRobot().disconnect();
  }
});

function setAppMode(nextMode) {
  if (nextMode !== "manual" && isRecording) {
    stopRecording(false);
  }

  if (nextMode !== "recordings" && isPlayingBack) {
    stopPlayback();
  }

  appMode = nextMode;
  const isManual = appMode === "manual";
  const isRecordings = appMode === "recordings";

  elements.manualPanel.hidden = !isManual;
  elements.recordingsPanel.hidden = !isRecordings;
  elements.locationsPanel.hidden = appMode !== "locations";
  elements.manualModeButton.classList.toggle("is-active", isManual);
  elements.recordingsModeButton.classList.toggle("is-active", isRecordings);
  elements.locationsModeButton.classList.toggle("is-active", appMode === "locations");
  elements.manualModeButton.setAttribute("aria-pressed", String(isManual));
  elements.recordingsModeButton.setAttribute("aria-pressed", String(isRecordings));
  elements.locationsModeButton.setAttribute("aria-pressed", String(appMode === "locations"));

  if (!isManual && !isPlayingBack) {
    currentPosition = { x: 0, y: 0 };
    updateTelemetry(currentPosition);
  }

  updateRecordingControls();
}

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

  if (state === "disconnected" && isPlayingBack) {
    stopPlayback("Reproduccion detenida: robot desconectado.");
  }

  updateRecordingControls();
}

function updateTelemetry({ x, y }) {
  elements.xValue.textContent = x.toFixed(2);
  elements.yValue.textContent = y.toFixed(2);
}

function updateLog(message) {
  elements.messageLog.textContent = message;
}

function handleRobotMessage(line) {
  const sensorData = parseUltrasonicMessage(line, getObstacleThresholdCm());
  if (!sensorData) return;

  if (!isPlayingBack || isAvoiding || injectedPlaybackFrames.length > 0) return;
  if (!sensorData.obstacle) return;
  if (Date.now() - lastObstacleTriggerAt < OBSTACLE_COOLDOWN_MS) return;

  startAvoidance(sensorData.distance);
}

function startAvoidance(distanceCm) {
  const currentFrame = playbackFrames[playbackIndex] ?? playbackFrames[playbackFrames.length - 1] ?? { x: 0, y: 0 };
  const rejoinIndex = playbackOriginalIndex;

  isAvoiding = true;
  lastObstacleTriggerAt = Date.now();
  injectedPlaybackFrames = buildAvoidanceManeuver(currentFrame);
  avoidanceRejoinIndex = rejoinIndex;

  const distanceLabel = Number.isFinite(distanceCm) ? `${distanceCm} cm` : "cerca";
  updatePlaybackProgress();
  updateLog(`Obstaculo a ${distanceLabel}. Esquivando y recalculando recorrido...`);
}

function finishAvoidance() {
  const { transitionFrames, rejoinIndex } = buildRejoinPlan(
    playbackEstimatedPose,
    playbackOriginalFrames,
    avoidanceRejoinIndex,
  );

  playbackFrames = playbackOriginalFrames.slice(rejoinIndex);
  playbackIndex = 0;
  playbackOriginalIndex = rejoinIndex;
  injectedPlaybackFrames = transitionFrames;
  isAvoiding = false;

  updatePlaybackProgress();
  updateLog(`Recorrido recalculado desde el paso ${rejoinIndex + 1}.`);
}

async function sendCoordinates(position = currentPosition) {
  return getActiveRobot().sendCoordinates(position);
}

function startRecording() {
  if (isPlayingBack || appMode !== "manual") return;

  isRecording = true;
  recordingFrames = [];
  updateRecordingControls();
  updateLog(`Grabando movimientos cada ${SEND_INTERVAL_MS} ms.`);
}

function stopRecording(shouldSave = true) {
  if (!isRecording) return;

  isRecording = false;
  const frames = recordingFrames;
  recordingFrames = [];
  updateRecordingControls();

  if (!shouldSave) {
    updateLog("Grabacion cancelada.");
    return;
  }

  if (frames.length === 0) {
    updateLog("No se guardo la grabacion: no hay movimientos registrados.");
    return;
  }

  const name = elements.recordingNameInput.value.trim() || `Grabacion ${savedRecordings.length + 1}`;
  const recording = {
    id: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()),
    name,
    intervalMs: SEND_INTERVAL_MS,
    frames,
    savedAt: Date.now(),
  };

  savedRecordings = [recording, ...savedRecordings].slice(0, 30);
  elements.recordingNameInput.value = "";
  persistSavedRecordings();
  renderSavedRecordings();
  updateLog(`Grabacion "${recording.name}" guardada (${formatRecordingDuration(recording)}).`);
}

async function startPlayback(recording) {
  const robot = getActiveRobot();

  if (!robot.isConnected) {
    updateLog("Conecta el robot antes de reproducir una grabacion.");
    return;
  }

  if (!Array.isArray(recording.frames) || recording.frames.length === 0) {
    updateLog("La grabacion no tiene movimientos para reproducir.");
    return;
  }

  if (isRecording) {
    stopRecording(false);
  }

  if (isPlayingBack) {
    stopPlayback();
  }

  isPlayingBack = true;
  playbackOriginalFrames = recording.frames.map((frame) => ({
    x: Number(frame.x),
    y: Number(frame.y),
  }));
  playbackFrames = playbackOriginalFrames.map((frame) => ({ ...frame }));
  playbackIndex = 0;
  playbackOriginalIndex = 0;
  playbackEstimatedPose = { x: 0, y: 0, heading: 0 };
  isAvoiding = false;
  injectedPlaybackFrames = [];
  lastObstacleTriggerAt = 0;
  avoidanceRejoinIndex = 0;
  playbackRecordingName = recording.name;
  joystick.setEnabled(false);
  setAppMode("recordings");
  updatePlaybackControls();
  updateLog(`Reproduciendo "${recording.name}" cada ${SEND_INTERVAL_MS} ms.`);
}

function stopPlayback(message = "") {
  if (!isPlayingBack) return;

  isPlayingBack = false;
  playbackFrames = [];
  playbackOriginalFrames = [];
  playbackIndex = 0;
  playbackOriginalIndex = 0;
  playbackEstimatedPose = { x: 0, y: 0, heading: 0 };
  isAvoiding = false;
  injectedPlaybackFrames = [];
  lastObstacleTriggerAt = 0;
  avoidanceRejoinIndex = 0;
  playbackRecordingName = "";
  joystick.setEnabled(true);
  currentPosition = { x: 0, y: 0 };
  updateTelemetry(currentPosition);
  updatePlaybackControls();
  updateRecordingControls();

  if (message) {
    updateLog(message);
  }
}

function updateRecordingControls() {
  elements.recordButton.disabled = isPlayingBack;
  elements.recordButton.classList.toggle("is-recording", isRecording);
  elements.recordButton.textContent = isRecording ? "Detener y guardar" : "Iniciar grabacion";
  elements.recordingNameInput.disabled = isRecording || isPlayingBack;
}

function updatePlaybackControls() {
  elements.stopPlaybackButton.hidden = !isPlayingBack;
  elements.playbackProgress.hidden = !isPlayingBack;
  elements.clearRecordingsButton.disabled = savedRecordings.length === 0 || isPlayingBack;
  updatePlaybackProgress();
  renderSavedRecordings();
}

function updatePlaybackProgress() {
  if (!isPlayingBack) {
    elements.playbackProgressName.textContent = "--";
    elements.playbackStepValue.textContent = "0 / 0";
    return;
  }

  elements.playbackProgressName.textContent = playbackRecordingName;

  if (isAvoiding || injectedPlaybackFrames.length > 0) {
    elements.playbackStepValue.textContent = `${playbackOriginalIndex} / ${playbackOriginalFrames.length} · esquivando`;
    return;
  }

  elements.playbackStepValue.textContent = `${playbackOriginalIndex} / ${playbackOriginalFrames.length}`;
}

function renderSavedRecordings() {
  elements.clearRecordingsButton.disabled = savedRecordings.length === 0 || isPlayingBack;

  if (savedRecordings.length === 0) {
    elements.savedRecordingsList.innerHTML = '<p class="empty-state">No hay grabaciones guardadas.</p>';
    return;
  }

  elements.savedRecordingsList.innerHTML = savedRecordings.map((recording) => {
    const savedDate = new Date(recording.savedAt).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const escapedId = escapeHtml(recording.id);
    const isActive = isPlayingBack && playbackRecordingName === recording.name;

    return `
      <article class="saved-location">
        <div>
          <strong>${escapeHtml(recording.name)}</strong>
          <span>${formatRecordingDuration(recording)} · cada ${recording.intervalMs || SEND_INTERVAL_MS} ms</span>
          <small>${savedDate}${isActive ? " · reproduciendo" : ""}</small>
        </div>
        <div class="location-actions">
          <button class="small-button" type="button" data-action="play" data-id="${escapedId}" ${isPlayingBack ? "disabled" : ""}>Reproducir</button>
          <button class="small-button danger" type="button" data-action="delete" data-id="${escapedId}" ${isPlayingBack ? "disabled" : ""}>Borrar</button>
        </div>
      </article>
    `;
  }).join("");
}

function loadSavedRecordings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECORDINGS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((recording) => (
      typeof recording?.id === "string" &&
      typeof recording?.name === "string" &&
      Array.isArray(recording?.frames) &&
      recording.frames.length > 0 &&
      recording.frames.every((frame) => Number.isFinite(frame?.x) && Number.isFinite(frame?.y))
    ));
  } catch {
    return [];
  }
}

function persistSavedRecordings() {
  window.localStorage.setItem(RECORDINGS_STORAGE_KEY, JSON.stringify(savedRecordings));
}

function formatRecordingDuration(recording) {
  const frameCount = recording.frames?.length || 0;
  const intervalMs = recording.intervalMs || SEND_INTERVAL_MS;
  const totalSeconds = (frameCount * intervalMs) / 1000;

  if (totalSeconds < 60) {
    return `${frameCount} pasos · ${totalSeconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${frameCount} pasos · ${minutes} min ${seconds} s`;
}

async function sendDestination(location) {
  const robot = getActiveRobot();

  if (!robot.isConnected) {
    updateLog("Conecta el robot antes de enviar una ubicacion.");
    return;
  }

  try {
    await robot.sendDestination(location);
    updateLog(`Destino enviado: ${location.name}.`);
  } catch (error) {
    updateLog(`Error enviando destino: ${error.message}`);
  }
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

function getConnectButtonLabel(state) {
  const transportLabel = elements.connectionMode.value === "serial" ? "Serial HC-05" : "Bluetooth BLE";

  if (state === "connected") return `Desconectar ${transportLabel}`;
  if (state === "connecting") return `Conectando ${transportLabel}`;
  return `Conectar ${transportLabel}`;
}

async function refreshCurrentLocation() {
  if (!("geolocation" in navigator)) {
    updateLog("Este navegador no tiene geolocalizacion disponible.");
    elements.gpsState.textContent = "No disponible";
    return;
  }

  elements.refreshLocationButton.disabled = true;
  elements.saveLocationButton.disabled = true;
  elements.gpsState.textContent = "Buscando...";

  try {
    currentLocation = await getCurrentLocation();
    updateLocationReadout();
    updateLog("Ubicacion GPS actualizada.");
  } catch (error) {
    elements.gpsState.textContent = "Sin permiso";
    updateLog(error.message || "No se pudo obtener la ubicacion del movil.");
  } finally {
    elements.refreshLocationButton.disabled = false;
    elements.saveLocationButton.disabled = false;
  }
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          savedAt: Date.now(),
        });
      },
      (error) => reject(normalizeGeolocationError(error)),
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 12000,
      },
    );
  });
}

function saveCurrentLocation() {
  if (!currentLocation) {
    updateLog("Actualiza el GPS antes de guardar una ubicacion.");
    return;
  }

  const name = elements.locationNameInput.value.trim() || `Punto ${savedLocations.length + 1}`;
  const location = {
    id: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()),
    name,
    latitude: currentLocation.latitude,
    longitude: currentLocation.longitude,
    accuracy: currentLocation.accuracy,
    savedAt: Date.now(),
  };

  savedLocations = [location, ...savedLocations].slice(0, 30);
  elements.locationNameInput.value = "";
  persistSavedLocations();
  renderSavedLocations();
  updateLog(`Ubicacion "${location.name}" guardada.`);
}

function updateLocationReadout() {
  if (!currentLocation) {
    elements.gpsState.textContent = "Sin iniciar";
    elements.latitudeValue.textContent = "--";
    elements.longitudeValue.textContent = "--";
    elements.accuracyValue.textContent = "--";
    return;
  }

  elements.gpsState.textContent = "Listo";
  elements.latitudeValue.textContent = formatCoordinate(currentLocation.latitude);
  elements.longitudeValue.textContent = formatCoordinate(currentLocation.longitude);
  elements.accuracyValue.textContent = `${Math.round(currentLocation.accuracy)} m`;
}

function renderSavedLocations() {
  elements.clearLocationsButton.disabled = savedLocations.length === 0;

  if (savedLocations.length === 0) {
    elements.savedLocationsList.innerHTML = '<p class="empty-state">No hay ubicaciones guardadas.</p>';
    return;
  }

  elements.savedLocationsList.innerHTML = savedLocations.map((location) => {
    const savedDate = new Date(location.savedAt).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const escapedId = escapeHtml(location.id);

    return `
      <article class="saved-location">
        <div>
          <strong>${escapeHtml(location.name)}</strong>
          <span>${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}</span>
          <small>${savedDate} · precision ${Math.round(location.accuracy)} m</small>
        </div>
        <div class="location-actions">
          <button class="small-button" type="button" data-action="go" data-id="${escapedId}">Ir</button>
          <button class="small-button danger" type="button" data-action="delete" data-id="${escapedId}">Borrar</button>
        </div>
      </article>
    `;
  }).join("");
}

function loadSavedLocations() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((location) => (
      typeof location?.id === "string" &&
      typeof location?.name === "string" &&
      Number.isFinite(location?.latitude) &&
      Number.isFinite(location?.longitude)
    ));
  } catch {
    return [];
  }
}

function persistSavedLocations() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedLocations));
}

function normalizeGeolocationError(error) {
  if (error?.code === error.PERMISSION_DENIED) {
    return new Error("Permiso de ubicacion denegado. Activalo para guardar puntos.");
  }

  if (error?.code === error.POSITION_UNAVAILABLE) {
    return new Error("El movil no pudo calcular la ubicacion actual.");
  }

  if (error?.code === error.TIMEOUT) {
    return new Error("El GPS tardo demasiado. Prueba en exterior o cerca de una ventana.");
  }

  return new Error("No se pudo obtener la ubicacion del movil.");
}

function formatCoordinate(value) {
  return Number(value).toFixed(7);
}

function getObstacleThresholdCm() {
  const threshold = Number(elements.obstacleThresholdCm.value);
  if (!Number.isFinite(threshold)) return DEFAULT_OBSTACLE_THRESHOLD_CM;
  return Math.max(5, Math.min(300, Math.round(threshold)));
}

function loadObstacleThreshold() {
  const stored = Number(window.localStorage.getItem(OBSTACLE_THRESHOLD_STORAGE_KEY));
  elements.obstacleThresholdCm.value = Number.isFinite(stored)
    ? String(Math.max(5, Math.min(300, Math.round(stored))))
    : String(DEFAULT_OBSTACLE_THRESHOLD_CM);
}

function persistObstacleThreshold() {
  const threshold = getObstacleThresholdCm();
  elements.obstacleThresholdCm.value = String(threshold);
  window.localStorage.setItem(OBSTACLE_THRESHOLD_STORAGE_KEY, String(threshold));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
