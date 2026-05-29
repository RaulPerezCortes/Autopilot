const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

export class BluetoothRobot {
  constructor({ onConnectionChange, onLog }) {
    this.device = null;
    this.server = null;
    this.rxCharacteristic = null;
    this.encoder = new TextEncoder();
    this.onConnectionChange = onConnectionChange;
    this.onLog = onLog;
    this.handleDisconnected = this.handleDisconnected.bind(this);
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
    this.onLog("Buscando dispositivos BLE compatibles con UART...");

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UART_SERVICE_UUID] }],
      optionalServices: [UART_SERVICE_UUID],
    });

    this.device.addEventListener("gattserverdisconnected", this.handleDisconnected);

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(UART_SERVICE_UUID);
    this.rxCharacteristic = await service.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);

    this.onConnectionChange("connected");
    this.onLog(`Conectado a ${this.device.name || "dispositivo BLE"}.`);
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  async sendCoordinates({ x, y }) {
    const message = `X:${formatAxis(x)},Y:${formatAxis(y)}\n`;
    return this.sendMessage(message);
  }

  async sendCommand(command) {
    return this.sendMessage(command);
  }

  async sendMessage(message) {
    if (!this.isConnected) return false;

    const data = this.encoder.encode(message);

    if (typeof this.rxCharacteristic.writeValueWithoutResponse === "function") {
      await this.rxCharacteristic.writeValueWithoutResponse(data);
    } else {
      await this.rxCharacteristic.writeValue(data);
    }

    return true;
  }

  handleDisconnected() {
    this.rxCharacteristic = null;
    this.server = null;
    this.onConnectionChange("disconnected");
    this.onLog("Bluetooth desconectado.");
  }
}

export class SerialRobot {
  constructor({ onConnectionChange, onLog, getBaudRate }) {
    this.port = null;
    this.writer = null;
    this.encoder = new TextEncoder();
    this.onConnectionChange = onConnectionChange;
    this.onLog = onLog;
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

    this.onConnectionChange("connected");
    this.onLog(`Conectado por puerto serie a ${this.getBaudRate()} baudios.`);
  }

  async disconnect() {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }

    this.onConnectionChange("disconnected");
    this.onLog("Puerto serie desconectado.");
  }

  async sendCoordinates({ x, y }) {
    const message = `X:${formatAxis(x)},Y:${formatAxis(y)}\n`;
    return this.sendMessage(message);
  }

  async sendCommand(command) {
    return this.sendMessage(command);
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
