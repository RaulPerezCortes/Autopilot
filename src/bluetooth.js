const BLE_UART_PROFILES = [
  {
    name: "Nordic UART",
    serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    writeCharacteristicUuids: ["6e400002-b5a3-f393-e0a9-e50e24dcca9e"],
    notifyCharacteristicUuids: ["6e400003-b5a3-f393-e0a9-e50e24dcca9e"],
  },
  {
    name: "HM-10 / AT-09 UART",
    serviceUuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
    writeCharacteristicUuids: ["0000ffe1-0000-1000-8000-00805f9b34fb"],
    notifyCharacteristicUuids: ["0000ffe1-0000-1000-8000-00805f9b34fb"],
  },
  {
    name: "JDY / BT05 UART",
    serviceUuid: "0000ffe5-0000-1000-8000-00805f9b34fb",
    writeCharacteristicUuids: ["0000ffe9-0000-1000-8000-00805f9b34fb"],
    notifyCharacteristicUuids: ["0000ffe9-0000-1000-8000-00805f9b34fb"],
  },
];

const OPTIONAL_BLE_SERVICES = BLE_UART_PROFILES.map((profile) => profile.serviceUuid);

export class BluetoothRobot {
  constructor({ onConnectionChange, onLog, onMessage }) {
    this.device = null;
    this.server = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.profileName = "";
    this.pendingMessage = null;
    this.sendTask = null;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.incomingBuffer = "";
    this.onConnectionChange = onConnectionChange;
    this.onLog = onLog;
    this.onMessage = onMessage;
    this.handleDisconnected = this.handleDisconnected.bind(this);
    this.handleCharacteristicValueChanged = this.handleCharacteristicValueChanged.bind(this);
  }

  get isSupported() {
    return "bluetooth" in navigator;
  }

  get isConnected() {
    return Boolean(this.device?.gatt?.connected && this.rxCharacteristic);
  }

  async connect() {
    if (!this.isSupported) {
      throw new Error("Web Bluetooth no esta disponible en este navegador.");
    }

    this.onConnectionChange("connecting");
    this.onLog("Selecciona tu modulo BLE. Se probaran UART Nordic, HM-10 y compatibles...");

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: OPTIONAL_BLE_SERVICES,
      });

      this.device.addEventListener("gattserverdisconnected", this.handleDisconnected);

      this.server = await this.device.gatt.connect();
      const { characteristic, profileName } = await findBleUartWriter(this.server);
      this.rxCharacteristic = characteristic;
      this.profileName = profileName;
      this.txCharacteristic = await findBleUartNotifier(this.server, profileName);

      if (this.txCharacteristic) {
        await this.txCharacteristic.startNotifications();
        this.txCharacteristic.addEventListener("characteristicvaluechanged", this.handleCharacteristicValueChanged);
      }

      this.onConnectionChange("connected");
      this.onLog(`Conectado a ${this.device.name || "dispositivo BLE"} por ${profileName}.`);
    } catch (error) {
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }

      this.rxCharacteristic = null;
      this.server = null;
      throw normalizeBluetoothError(error);
    }
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  async sendCoordinates({ x, y }) {
    const message = `${formatAxis(x)},${formatAxis(y)}\n`;
    return this.sendMessage(message);
  }

  async sendDestination({ latitude, longitude }) {
    const message = `GOTO:${formatCoordinate(latitude)},${formatCoordinate(longitude)}\n`;
    return this.sendMessage(message);
  }

  async sendMessage(message) {
    if (!this.isConnected) return false;

    this.pendingMessage = message;

    if (!this.sendTask) {
      this.sendTask = this.flushPendingMessages();
    }

    return this.sendTask;
  }

  async flushPendingMessages() {
    try {
      while (this.isConnected && this.pendingMessage !== null) {
        const message = this.pendingMessage;
        this.pendingMessage = null;
        await this.writeBleMessage(message);
      }

      return true;
    } finally {
      this.sendTask = null;

      if (this.isConnected && this.pendingMessage !== null) {
        void this.flushPendingMessages();
      }
    }
  }

  async writeBleMessage(message) {
    const data = this.encoder.encode(message);

    if (
      this.rxCharacteristic.properties.writeWithoutResponse &&
      typeof this.rxCharacteristic.writeValueWithoutResponse === "function"
    ) {
      await this.rxCharacteristic.writeValueWithoutResponse(data);
      return;
    }

    if (
      this.rxCharacteristic.properties.write &&
      typeof this.rxCharacteristic.writeValueWithResponse === "function"
    ) {
      await this.rxCharacteristic.writeValueWithResponse(data);
      return;
    }

    await this.rxCharacteristic.writeValue(data);
  }

  handleCharacteristicValueChanged(event) {
    const value = event.target.value;
    this.processIncomingChunk(this.decoder.decode(value));
  }

  processIncomingChunk(chunk) {
    this.incomingBuffer += chunk;

    let newlineIndex = this.incomingBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.incomingBuffer.slice(0, newlineIndex).trim();
      this.incomingBuffer = this.incomingBuffer.slice(newlineIndex + 1);

      if (line && typeof this.onMessage === "function") {
        this.onMessage(line);
      }

      newlineIndex = this.incomingBuffer.indexOf("\n");
    }
  }

  handleDisconnected() {
    if (this.txCharacteristic) {
      this.txCharacteristic.removeEventListener("characteristicvaluechanged", this.handleCharacteristicValueChanged);
    }

    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.server = null;
    this.profileName = "";
    this.pendingMessage = null;
    this.sendTask = null;
    this.incomingBuffer = "";
    this.onConnectionChange("disconnected");
    this.onLog("Bluetooth desconectado.");
  }
}

async function findBleUartWriter(server) {
  let foundKnownService = false;

  for (const profile of BLE_UART_PROFILES) {
    let service;

    try {
      service = await server.getPrimaryService(profile.serviceUuid);
      foundKnownService = true;
    } catch {
      continue;
    }

    for (const characteristicUuid of profile.writeCharacteristicUuids) {
      try {
        const characteristic = await service.getCharacteristic(characteristicUuid);

        if (canWrite(characteristic)) {
          return { characteristic, profileName: profile.name };
        }
      } catch {
        // Some modules use the expected service with a different writable characteristic.
      }
    }

    const writableCharacteristic = await findAnyWritableCharacteristic(service);
    if (writableCharacteristic) {
      return { characteristic: writableCharacteristic, profileName: profile.name };
    }
  }

  if (foundKnownService) {
    throw new Error("El modulo BLE tiene un servicio UART conocido, pero no una caracteristica de escritura compatible.");
  }

  throw new Error("El dispositivo BLE no expone UART compatible. Si es HC-05/HC-06 usa el modo Serial; si es ESP32, anuncia Nordic UART o FFE0/FFE1.");
}

async function findBleUartNotifier(server, profileName) {
  const profile = BLE_UART_PROFILES.find((item) => item.name === profileName);
  if (!profile) return null;

  let service;

  try {
    service = await server.getPrimaryService(profile.serviceUuid);
  } catch {
    return null;
  }

  for (const characteristicUuid of profile.notifyCharacteristicUuids || []) {
    try {
      const characteristic = await service.getCharacteristic(characteristicUuid);
      if (characteristic.properties.notify || characteristic.properties.indicate) {
        return characteristic;
      }
    } catch {
      // Try the next notify characteristic for this profile.
    }
  }

  try {
    const characteristics = await service.getCharacteristics();
    return characteristics.find((characteristic) => (
      characteristic.properties.notify || characteristic.properties.indicate
    )) || null;
  } catch {
    return null;
  }
}

async function findAnyWritableCharacteristic(service) {
  try {
    const characteristics = await service.getCharacteristics();
    return characteristics.find(canWrite) || null;
  } catch {
    return null;
  }
}

function canWrite(characteristic) {
  return Boolean(characteristic?.properties?.write || characteristic?.properties?.writeWithoutResponse);
}

function normalizeBluetoothError(error) {
  if (error?.name === "NotFoundError") {
    return new Error("No se selecciono ningun dispositivo BLE.");
  }

  if (error?.name === "SecurityError") {
    return new Error("El navegador ha bloqueado Bluetooth. Usa Chrome o Edge en HTTPS/localhost y concede permiso.");
  }

  if (error?.message) {
    return error;
  }

  return new Error("No se pudo conectar con el modulo BLE.");
}

export class SerialRobot {
  constructor({ onConnectionChange, onLog, onMessage, getBaudRate }) {
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.readLoopActive = false;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.incomingBuffer = "";
    this.onConnectionChange = onConnectionChange;
    this.onLog = onLog;
    this.onMessage = onMessage;
    this.getBaudRate = getBaudRate;
  }

  get isSupported() {
    return "serial" in navigator;
  }

  get isConnected() {
    return Boolean(this.port && this.writer);
  }

  async connect() {
    if (!this.isSupported) {
      throw new Error("Web Serial no esta disponible. Usa Chrome o Edge en HTTPS/localhost.");
    }

    this.onConnectionChange("connecting");
    this.onLog("Selecciona el puerto serie del HC-05 emparejado...");

    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.getBaudRate() });
    this.writer = this.port.writable.getWriter();
    this.readLoopActive = true;
    void this.readLoop();

    this.onConnectionChange("connected");
    this.onLog(`Conectado por puerto serie a ${this.getBaudRate()} baudios.`);
  }

  async readLoop() {
    if (!this.port?.readable) return;

    this.reader = this.port.readable.getReader();

    try {
      while (this.readLoopActive) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.processIncomingChunk(this.decoder.decode(value, { stream: true }));
      }
    } catch {
      // Serial read loop ends when the port closes.
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
  }

  processIncomingChunk(chunk) {
    this.incomingBuffer += chunk;

    let newlineIndex = this.incomingBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.incomingBuffer.slice(0, newlineIndex).trim();
      this.incomingBuffer = this.incomingBuffer.slice(newlineIndex + 1);

      if (line && typeof this.onMessage === "function") {
        this.onMessage(line);
      }

      newlineIndex = this.incomingBuffer.indexOf("\n");
    }
  }

  async disconnect() {
    this.readLoopActive = false;

    if (this.reader) {
      await this.reader.cancel().catch(() => {});
    }

    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }

    this.incomingBuffer = "";
    this.onConnectionChange("disconnected");
    this.onLog("Puerto serie desconectado.");
  }

  async sendCoordinates({ x, y }) {
    const message = `${formatAxis(x)},${formatAxis(y)}\n`;
    return this.sendMessage(message);
  }

  async sendDestination({ latitude, longitude }) {
    const message = `GOTO:${formatCoordinate(latitude)},${formatCoordinate(longitude)}\n`;
    return this.sendMessage(message);
  }

  async sendMessage(message) {
    if (!this.isConnected) return false;

    await this.writer.write(this.encoder.encode(message));
    return true;
  }
}

export function formatAxis(value) {
  return Number(value).toFixed(2);
}

export function formatCoordinate(value) {
  return Number(value).toFixed(7);
}
