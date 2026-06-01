import { BluetoothRobot, SerialRobot } from "./bluetooth.js";
import { JoystickController } from "./joystick.js";

const SEND_INTERVAL_MS = 50;
const STORAGE_KEY = "robot.savedLocations";

const elements = {
  connectButton: document.querySelector("#connectButton"),
  connectionPill: document.querySelector("#connectionPill"),
  connectionState: document.querySelector("#connectionState"),
  messageLog: document.querySelector("#messageLog"),
  connectionMode: document.querySelector("#connectionMode"),
  baudRate: document.querySelector("#baudRate"),
  xValue: document.querySelector("#xValue"),
  yValue: document.querySelector("#yValue"),
  manualModeButton: document.querySelector("#manualModeButton"),
  locationsModeButton: document.querySelector("#locationsModeButton"),
  manualPanel: document.querySelector("#manualPanel"),
  locationsPanel: document.querySelector("#locationsPanel"),
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
updateLocationReadout();
renderSavedLocations();
updateConnectionMode();
setAppMode("manual");

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

elements.manualModeButton.addEventListener("click", () => setAppMode("manual"));

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

sendTimer = window.setInterval(async () => {
  const robot = getActiveRobot();
  if (appMode !== "manual" || !robot.isConnected) return;

  try {
    await sendCoordinates();
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

function setAppMode(nextMode) {
  appMode = nextMode;
  const isManual = appMode === "manual";

  elements.manualPanel.hidden = !isManual;
  elements.locationsPanel.hidden = isManual;
  elements.manualModeButton.classList.toggle("is-active", isManual);
  elements.locationsModeButton.classList.toggle("is-active", !isManual);
  elements.manualModeButton.setAttribute("aria-pressed", String(isManual));
  elements.locationsModeButton.setAttribute("aria-pressed", String(!isManual));

  if (!isManual) {
    currentPosition = { x: 0, y: 0 };
    updateTelemetry(currentPosition);
  }
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
}

function updateTelemetry({ x, y }) {
  elements.xValue.textContent = x.toFixed(2);
  elements.yValue.textContent = y.toFixed(2);
}

function updateLog(message) {
  elements.messageLog.textContent = message;
}

async function sendCoordinates() {
  return getActiveRobot().sendCoordinates(currentPosition);
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
