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
      throw new Error("Web Bluetooth no está disponible en este navegador.");
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

export function formatAxis(value) {
  return Number(value).toFixed(2);
}
