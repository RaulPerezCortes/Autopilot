import { BluetoothRobot, SerialRobot } from "./bluetooth.js";
import { JoystickController } from "./joystick.js";
import {
  DEFAULT_OBSTACLE_THRESHOLD_CM,
  parseUltrasonicMessage,
  SEND_INTERVAL_MS,
} from "./obstacleAvoidance.js";

const PRECAUTION_DELAY_MS = 2000;
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

// ── Estado general ────────────────────────────────────────────────────────────
let appMode         = "manual";
let currentPosition = { x: 0, y: 0 };
let currentLocation = null;
let savedLocations  = loadSavedLocations();
let savedRecordings = loadSavedRecordings();
let sendTimer       = null;

// ── Grabación ─────────────────────────────────────────────────────────────────
let isRecording    = false;
let recordingFrames = [];

// ── Reproducción ──────────────────────────────────────────────────────────────
let isPlayingBack         = false;
let playbackFrames        = [];
let playbackIndex         = 0;
let playbackRecordingName = "";

// ── Obstáculo ─────────────────────────────────────────────────────────────────
let obstaclePaused = false;   // true = robot parado esperando que se despeje
let obstacleLeftAt = 0;       // timestamp en que desapareció el obstáculo (0 = sigue ahí)
let pausedAtIndex  = 0;       // paso exacto donde se congeló la reproducción

// ── Robots y joystick ─────────────────────────────────────────────────────────
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

// ── Event listeners ───────────────────────────────────────────────────────────
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

elements.obstacleThresholdCm.addEventListener("change", () => persistObstacleThreshold());
elements.obstacleThresholdCm.addEventListener("input",  () => persistObstacleThreshold());

elements.manualModeButton.addEventListener("click",    () => setAppMode("manual"));
elements.recordingsModeButton.addEventListener("click",() => setAppMode("recordings"));
elements.locationsModeButton.addEventListener("click", () => {
  setAppMode("locations");
  if (!currentLocation) void refreshCurrentLocation();
});

elements.refreshLocationButton.addEventListener("click", () => void refreshCurrentLocation());
elements.saveLocationButton.addEventListener("click",    () => saveCurrentLocation());

elements.clearLocationsButton.addEventListener("click", () => {
  if (savedLocations.length === 0) return;
  if (!window.confirm("¿Borrar todas las ubicaciones guardadas?")) return;
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
    updateLog(`Ubicación "${location.name}" eliminada.`);
  }
});

elements.recordButton.addEventListener("click", () => {
  if (isPlayingBack) return;
  if (isRecording) { stopRecording(); return; }
  startRecording();
});

elements.clearRecordingsButton.addEventListener("click", () => {
  if (savedRecordings.length === 0) return;
  if (!window.confirm("¿Borrar todas las grabaciones guardadas?")) return;
  savedRecordings = [];
  persistSavedRecordings();
  renderSavedRecordings();
  updateLog("Grabaciones guardadas borradas.");
});

elements.stopPlaybackButton.addEventListener("click", () => stopPlayback("Reproducción detenida."));

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
    if (isPlayingBack && playbackRecordingName === recording.name) stopPlayback();
    savedRecordings = savedRecordings.filter((item) => item.id !== recording.id);
    persistSavedRecordings();
    renderSavedRecordings();
    updateLog(`Grabación "${recording.name}" eliminada.`);
  }
});

// ── Bucle principal de envío ──────────────────────────────────────────────────
sendTimer = window.setInterval(async () => {
  const robot = getActiveRobot();
  if (!robot.isConnected) return;

  let position = null;

  if (isPlayingBack) {
    if (obstaclePaused) {
      // Comprobar si ya pasó el tiempo de precaución
      const precautionDone =
        obstacleLeftAt > 0 &&
        Date.now() - obstacleLeftAt >= PRECAUTION_DELAY_MS;

      if (precautionDone) {
        // Reanudar desde el paso exacto donde se paró
        obstaclePaused = false;
        obstacleLeftAt = 0;
        playbackIndex  = pausedAtIndex;
        updateLog(`Obstáculo despejado. Reanudando desde paso ${pausedAtIndex + 1}.`);
        updatePlaybackProgress();
        return; // el siguiente tick ya envía el frame correcto
      }

      // Aún parado: mandar 0,0
      position = { x: 0, y: 0 };
    } else {
      // Reproducción normal
      if (playbackIndex >= playbackFrames.length) {
        stopPlayback(`Reproducción "${playbackRecordingName}" finalizada.`);
        return;
      }
      position = playbackFrames[playbackIndex];
      playbackIndex++;
    }

    updateTelemetry(position);
    updatePlaybackProgress();

  } else if (appMode === "manual") {
    position = currentPosition;
    if (isRecording) {
      recordingFrames.push({ x: position.x, y: position.y });
    }
  }

  if (!position) return;

  try {
    await robot.sendCoordinates(position);
  } catch (error) {
    updateLog(`Error enviando datos: ${error.message}`);
    if (isPlayingBack) stopPlayback("Reproducción interrumpida por error de envío.");
  }
}, SEND_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  window.clearInterval(sendTimer);
  stopPlayback();
  stopRecording(false);
  if (getActiveRobot().isConnected) getActiveRobot().disconnect();
});

// ── Mensajes del robot (sensor de distancia) ──────────────────────────────────
function handleRobotMessage(line) {
  const sensorData = parseUltrasonicMessage(line, getObstacleThresholdCm());
  if (!sensorData || !isPlayingBack) return;

  if (sensorData.obstacle) {
    // Objeto detectado → congelar si no estaba ya congelado
    if (!obstaclePaused) {
      obstaclePaused = true;
      obstacleLeftAt = 0;
      pausedAtIndex  = playbackIndex;   // guardamos el paso exacto
      const label = Number.isFinite(sensorData.distance)
        ? `${sensorData.distance} cm`
        : "cerca";
      updateLog(`Obstáculo a ${label}. Robot parado en paso ${pausedAtIndex + 1}.`);
      updatePlaybackProgress();
    }
  } else {
    // Objeto despejado → arrancar temporizador de precaución (solo una vez)
    if (obstaclePaused && obstacleLeftAt === 0) {
      obstacleLeftAt = Date.now();
      updateLog(`Obstáculo despejado. Reanudando en ${PRECAUTION_DELAY_MS / 1000} s...`);
    }
  }
}

// ── Reproducción ──────────────────────────────────────────────────────────────
async function startPlayback(recording) {
  const robot = getActiveRobot();
  if (!robot.isConnected) {
    updateLog("Conecta el robot antes de reproducir una grabación.");
    return;
  }
  if (!Array.isArray(recording.frames) || recording.frames.length === 0) {
    updateLog("La grabación no tiene movimientos para reproducir.");
    return;
  }
  if (isRecording) stopRecording(false);
  if (isPlayingBack) stopPlayback();

  isPlayingBack         = true;
  playbackFrames        = recording.frames.map((f) => ({ x: Number(f.x), y: Number(f.y) }));
  playbackIndex         = 0;
  playbackRecordingName = recording.name;
  obstaclePaused        = false;
  obstacleLeftAt        = 0;
  pausedAtIndex         = 0;

  joystick.setEnabled(false);
  setAppMode("recordings");
  updatePlaybackControls();
  updateLog(`Reproduciendo "${recording.name}" cada ${SEND_INTERVAL_MS} ms.`);
}

function stopPlayback(message = "") {
  if (!isPlayingBack) return;

  isPlayingBack         = false;
  playbackFrames        = [];
  playbackIndex         = 0;
  playbackRecordingName = "";
  obstaclePaused        = false;
  obstacleLeftAt        = 0;
  pausedAtIndex         = 0;

  joystick.setEnabled(true);
  currentPosition = { x: 0, y: 0 };
  updateTelemetry(currentPosition);
  updatePlaybackControls();
  updateRecordingControls();
  if (message) updateLog(message);
}

// ── Grabación ─────────────────────────────────────────────────────────────────
function startRecording() {
  if (isPlayingBack || appMode !== "manual") return;
  isRecording     = true;
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
    updateLog("Grabación cancelada.");
    return;
  }
  if (frames.length === 0) {
    updateLog("No se guardó la grabación: no hay movimientos registrados.");
    return;
  }

  const name = elements.recordingNameInput.value.trim() || `Grabación ${savedRecordings.length + 1}`;
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
  updateLog(`Grabación "${recording.name}" guardada (${formatRecordingDuration(recording)}).`);
}

// ── UI ────────────────────────────────────────────────────────────────────────
function setAppMode(nextMode) {
  if (nextMode !== "manual" && isRecording) stopRecording(false);
  if (nextMode !== "recordings" && isPlayingBack) stopPlayback();

  appMode = nextMode;
  const isManual      = appMode === "manual";
  const isRecordings  = appMode === "recordings";
  const isLocations   = appMode === "locations";

  elements.manualPanel.hidden    = !isManual;
  elements.recordingsPanel.hidden = !isRecordings;
  elements.locationsPanel.hidden  = !isLocations;

  elements.manualModeButton.classList.toggle("is-active", isManual);
  elements.recordingsModeButton.classList.toggle("is-active", isRecordings);
  elements.locationsModeButton.classList.toggle("is-active", isLocations);
  elements.manualModeButton.setAttribute("aria-pressed", String(isManual));
  elements.recordingsModeButton.setAttribute("aria-pressed", String(isRecordings));
  elements.locationsModeButton.setAttribute("aria-pressed", String(isLocations));

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
  elements.connectionState.textContent  = labels[state] || labels.disconnected;
  elements.connectButton.classList.toggle("is-connected", state === "connected");
  elements.connectionMode.disabled = state !== "disconnected";
  elements.baudRate.disabled =
    state !== "disconnected" || elements.connectionMode.value !== "serial";
  elements.connectButton.textContent = getConnectButtonLabel(state);

  if (state === "disconnected" && isPlayingBack) {
    stopPlayback("Reproducción detenida: robot desconectado.");
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

function updateRecordingControls() {
  elements.recordButton.disabled = isPlayingBack;
  elements.recordButton.classList.toggle("is-recording", isRecording);
  elements.recordButton.textContent = isRecording ? "Detener y guardar" : "Iniciar grabación";
  elements.recordingNameInput.disabled = isRecording || isPlayingBack;
}

function updatePlaybackControls() {
  elements.stopPlaybackButton.hidden    = !isPlayingBack;
  elements.playbackProgress.hidden      = !isPlayingBack;
  elements.clearRecordingsButton.disabled = savedRecordings.length === 0 || isPlayingBack;
  updatePlaybackProgress();
  renderSavedRecordings();
}

function updatePlaybackProgress() {
  if (!isPlayingBack) {
    elements.playbackProgressName.textContent = "--";
    elements.playbackStepValue.textContent    = "0 / 0";
    return;
  }

  elements.playbackProgressName.textContent = playbackRecordingName;

  const label = obstaclePaused ? " · parado por obstáculo" : "";
  elements.playbackStepValue.textContent =
    `${playbackIndex} / ${playbackFrames.length}${label}`;
}

function renderSavedRecordings() {
  elements.clearRecordingsButton.disabled = savedRecordings.length === 0 || isPlayingBack;

  if (savedRecordings.length === 0) {
    elements.savedRecordingsList.innerHTML =
      '<p class="empty-state">No hay grabaciones guardadas.</p>';
    return;
  }

  elements.savedRecordingsList.innerHTML = savedRecordings.map((recording) => {
    const savedDate = new Date(recording.savedAt).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const escapedId = escapeHtml(recording.id);
    const isActive  = isPlayingBack && playbackRecordingName === recording.name;

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

// ── GPS / Ubicaciones ─────────────────────────────────────────────────────────
async function refreshCurrentLocation() {
  if (!("geolocation" in navigator)) {
    updateLog("Este navegador no tiene geolocalización disponible.");
    elements.gpsState.textContent = "No disponible";
    return;
  }

  elements.refreshLocationButton.disabled = true;
  elements.saveLocationButton.disabled    = true;
  elements.gpsState.textContent = "Buscando...";

  try {
    currentLocation = await getCurrentLocation();
    updateLocationReadout();
    updateLog("Ubicación GPS actualizada.");
  } catch (error) {
    elements.gpsState.textContent = "Sin permiso";
    updateLog(error.message || "No se pudo obtener la ubicación del móvil.");
  } finally {
    elements.refreshLocationButton.disabled = false;
    elements.saveLocationButton.disabled    = false;
  }
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude:  position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy:  position.coords.accuracy,
        savedAt:   Date.now(),
      }),
      (error) => reject(normalizeGeolocationError(error)),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
    );
  });
}

function saveCurrentLocation() {
  if (!currentLocation) {
    updateLog("Actualiza el GPS antes de guardar una ubicación.");
    return;
  }

  const name = elements.locationNameInput.value.trim() || `Punto ${savedLocations.length + 1}`;
  const location = {
    id:        window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()),
    name,
    latitude:  currentLocation.latitude,
    longitude: currentLocation.longitude,
    accuracy:  currentLocation.accuracy,
    savedAt:   Date.now(),
  };

  savedLocations = [location, ...savedLocations].slice(0, 30);
  elements.locationNameInput.value = "";
  persistSavedLocations();
  renderSavedLocations();
  updateLog(`Ubicación "${location.name}" guardada.`);
}

async function sendDestination(location) {
  const robot = getActiveRobot();
  if (!robot.isConnected) {
    updateLog("Conecta el robot antes de enviar una ubicación.");
    return;
  }
  try {
    await robot.sendDestination(location);
    updateLog(`Destino enviado: ${location.name}.`);
  } catch (error) {
    updateLog(`Error enviando destino: ${error.message}`);
  }
}

function updateLocationReadout() {
  if (!currentLocation) {
    elements.gpsState.textContent      = "Sin iniciar";
    elements.latitudeValue.textContent  = "--";
    elements.longitudeValue.textContent = "--";
    elements.accuracyValue.textContent  = "--";
    return;
  }

  elements.gpsState.textContent      = "Listo";
  elements.latitudeValue.textContent  = formatCoordinate(currentLocation.latitude);
  elements.longitudeValue.textContent = formatCoordinate(currentLocation.longitude);
  elements.accuracyValue.textContent  = `${Math.round(currentLocation.accuracy)} m`;
}

function renderSavedLocations() {
  elements.clearLocationsButton.disabled = savedLocations.length === 0;

  if (savedLocations.length === 0) {
    elements.savedLocationsList.innerHTML =
      '<p class="empty-state">No hay ubicaciones guardadas.</p>';
    return;
  }

  elements.savedLocationsList.innerHTML = savedLocations.map((location) => {
    const savedDate = new Date(location.savedAt).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const escapedId = escapeHtml(location.id);

    return `
      <article class="saved-location">
        <div>
          <strong>${escapeHtml(location.name)}</strong>
          <span>${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}</span>
          <small>${savedDate} · precisión ${Math.round(location.accuracy)} m</small>
        </div>
        <div class="location-actions">
          <button class="small-button" type="button" data-action="go"     data-id="${escapedId}">Ir</button>
          <button class="small-button danger" type="button" data-action="delete" data-id="${escapedId}">Borrar</button>
        </div>
      </article>
    `;
  }).join("");
}

// ── Persistencia ──────────────────────────────────────────────────────────────
function loadSavedRecordings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECORDINGS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) =>
      typeof r?.id === "string" &&
      typeof r?.name === "string" &&
      Array.isArray(r?.frames) &&
      r.frames.length > 0 &&
      r.frames.every((f) => Number.isFinite(f?.x) && Number.isFinite(f?.y)),
    );
  } catch { return []; }
}

function persistSavedRecordings() {
  window.localStorage.setItem(RECORDINGS_STORAGE_KEY, JSON.stringify(savedRecordings));
}

function loadSavedLocations() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l) =>
      typeof l?.id === "string" &&
      typeof l?.name === "string" &&
      Number.isFinite(l?.latitude) &&
      Number.isFinite(l?.longitude),
    );
  } catch { return []; }
}

function persistSavedLocations() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedLocations));
}

// ── Utilidades ────────────────────────────────────────────────────────────────
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
    ? "HC-05 listo: emparéjalo en el sistema y selecciona su puerto serie."
    : "BLE UART listo: selecciona tu módulo y se probarán perfiles Nordic/HM-10 compatibles.",
  );
}

function getConnectButtonLabel(state) {
  const transportLabel = elements.connectionMode.value === "serial"
    ? "Serial HC-05" : "Bluetooth BLE";
  if (state === "connected")  return `Desconectar ${transportLabel}`;
  if (state === "connecting") return `Conectando ${transportLabel}`;
  return `Conectar ${transportLabel}`;
}

function getObstacleThresholdCm() {
  const threshold = Number(elements.obstacleThresholdCm.value);
  if (!Number.isFinite(threshold)) return DEFAULT_OBSTACLE_THRESHOLD_CM;
  return Math.max(0, Math.min(300, Math.round(threshold)));
}

function loadObstacleThreshold() {
  const stored = Number(window.localStorage.getItem(OBSTACLE_THRESHOLD_STORAGE_KEY));
  elements.obstacleThresholdCm.value = Number.isFinite(stored)
    ? String(Math.max(0, Math.min(300, Math.round(stored))))
    : String(DEFAULT_OBSTACLE_THRESHOLD_CM);
}

function persistObstacleThreshold() {
  const threshold = getObstacleThresholdCm();
  elements.obstacleThresholdCm.value = String(threshold);
  window.localStorage.setItem(OBSTACLE_THRESHOLD_STORAGE_KEY, String(threshold));
}

function formatRecordingDuration(recording) {
  const frameCount   = recording.frames?.length || 0;
  const intervalMs   = recording.intervalMs || SEND_INTERVAL_MS;
  const totalSeconds = (frameCount * intervalMs) / 1000;

  if (totalSeconds < 60) return `${frameCount} pasos · ${totalSeconds.toFixed(1)} s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${frameCount} pasos · ${minutes} min ${seconds} s`;
}

function normalizeGeolocationError(error) {
  if (error?.code === error.PERMISSION_DENIED) {
    return new Error("Permiso de ubicación denegado. Actívalo para guardar puntos.");
  }
  if (error?.code === error.POSITION_UNAVAILABLE) {
    return new Error("El móvil no pudo calcular la ubicación actual.");
  }
  if (error?.code === error.TIMEOUT) {
    return new Error("El GPS tardó demasiado. Prueba en exterior o cerca de una ventana.");
  }
  return new Error("No se pudo obtener la ubicación del móvil.");
}

function formatCoordinate(value) {
  return Number(value).toFixed(7);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}