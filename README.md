# Control Robot Bluetooth con Vite

Aplicacion web movil en JavaScript vanilla para controlar un robot Arduino/ESP32 mediante Web Bluetooth BLE o Web Serial. El modo Web Serial permite usar modulos Bluetooth clasicos como HC-05 y HC-06 cuando ya estan emparejados con el sistema operativo. El joystick envia coordenadas normalizadas cada 50 ms como maximo con este formato:

```text
X:0.52,Y:-0.33
```

## Ejecutar

```bash
npm install
npm run dev
```

Abre la URL local de Vite desde Chrome o Edge. Web Bluetooth y Web Serial exigen un contexto seguro: `localhost` o HTTPS.

## Usar HC-05 / HC-06 con Web Serial

1. Empareja el HC-05/HC-06 desde el Bluetooth del sistema operativo. El PIN habitual es `1234` o `0000`.
2. En la app, cambia `Conexion` a `Serial HC-05 / HC-06`.
3. Selecciona los baudios configurados en el modulo. Lo normal en modo datos es `9600`.
4. Pulsa `Conectar Serial HC-05` y elige el puerto serie Bluetooth en el dialogo del navegador.

El modo `Coordenadas X/Y` envia lineas terminadas en `\n`, por ejemplo `X:0.52,Y:-0.33`. El modo `Letras F/B/L/R/S` envia un solo caracter por comando para sketches que leen con `Serial.read()`.

## Publicar en GitHub Pages

El proyecto incluye un workflow en `.github/workflows/deploy.yml`. Al hacer push a `main`, GitHub Actions instala dependencias, ejecuta `npm run build` y publica la carpeta `dist` en GitHub Pages.

En GitHub, configura Pages para usar `GitHub Actions` como origen de despliegue.

## BLE UART esperado

La app busca un dispositivo BLE con el servicio Nordic UART:

- Servicio: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- Caracteristica RX: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`

El navegador escribe lineas de texto terminadas en `\n`. El ESP32 acumula caracteres hasta el salto de linea, parsea `X:<valor>,Y:<valor>` y transforma esos valores en velocidad izquierda/derecha.

## Ejemplo ESP32 BLE + motores

Este ejemplo usa la libreria BLE incluida en el core de ESP32 para Arduino y un driver tipo TB6612/L298N con dos pines de direccion y un PWM por motor. Ajusta los pines a tu placa.

```cpp
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define UART_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_RX_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_TX_UUID      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

const int LEFT_PWM = 25;
const int LEFT_IN1 = 26;
const int LEFT_IN2 = 27;
const int RIGHT_PWM = 14;
const int RIGHT_IN1 = 12;
const int RIGHT_IN2 = 13;

String inputLine;

void setMotor(int pwmPin, int in1, int in2, int speed) {
  speed = constrain(speed, -255, 255);

  if (speed > 0) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else if (speed < 0) {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }

  analogWrite(pwmPin, abs(speed));
}

void driveRobot(float x, float y) {
  x = constrain(x, -1.0, 1.0);
  y = constrain(y, -1.0, 1.0);

  float left = y + x;
  float right = y - x;
  float maxValue = max(1.0f, max(abs(left), abs(right)));

  int leftSpeed = (left / maxValue) * 255;
  int rightSpeed = (right / maxValue) * 255;

  setMotor(LEFT_PWM, LEFT_IN1, LEFT_IN2, leftSpeed);
  setMotor(RIGHT_PWM, RIGHT_IN1, RIGHT_IN2, rightSpeed);
}

void parseCommand(String line) {
  line.trim();
  int xIndex = line.indexOf("X:");
  int yIndex = line.indexOf(",Y:");

  if (xIndex != 0 || yIndex < 0) return;

  float x = line.substring(2, yIndex).toFloat();
  float y = line.substring(yIndex + 3).toFloat();
  driveRobot(x, y);
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) {
    String data = characteristic->getValue();

    for (int i = 0; i < data.length(); i++) {
      char c = data[i];
      if (c == '\n') {
        parseCommand(inputLine);
        inputLine = "";
      } else {
        inputLine += c;
      }
    }
  }
};

void setup() {
  pinMode(LEFT_IN1, OUTPUT);
  pinMode(LEFT_IN2, OUTPUT);
  pinMode(RIGHT_IN1, OUTPUT);
  pinMode(RIGHT_IN2, OUTPUT);

  BLEDevice::init("Robot-ESP32");
  BLEServer *server = BLEDevice::createServer();
  BLEService *service = server->createService(UART_SERVICE_UUID);

  BLECharacteristic *rx = service->createCharacteristic(
    UART_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(new RxCallbacks());

  service->createCharacteristic(UART_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY)
    ->addDescriptor(new BLE2902());

  service->start();
  server->getAdvertising()->addServiceUUID(UART_SERVICE_UUID);
  server->getAdvertising()->start();
}

void loop() {
}
```
