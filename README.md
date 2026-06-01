# Control Robot Bluetooth con Vite

Aplicacion web movil en JavaScript vanilla para controlar un robot Arduino/ESP32 mediante Web Bluetooth BLE o Web Serial. El modo Web Serial permite usar modulos Bluetooth clasicos como HC-05 y HC-06 cuando ya estan emparejados con el sistema operativo. El joystick envia coordenadas normalizadas cada 50 ms como maximo con este formato:

```text
0.52,-0.33
```

Tambien incluye un modo de ubicaciones: el movil, montado en el robot, usa su GPS para guardar puntos y despues enviar un destino guardado al robot.

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

La app envia coordenadas X/Y en lineas terminadas en `\n`.

## Modo Ubicaciones

1. Monta el movil en el robot y abre la app desde Chrome o Edge.
2. Entra en `Ubicaciones`.
3. Pulsa `Actualizar` para leer el GPS del movil.
4. Escribe un nombre y pulsa `Guardar ubicacion actual`.
5. Mas tarde, conecta el robot, entra en `Ubicaciones` y pulsa `Ir` en el punto guardado.

Las ubicaciones se guardan en el navegador del movil con `localStorage`. Si borras datos del sitio o usas otro navegador, la lista no aparecera.

Cuando pulsas `Ir`, la app envia una linea de texto por BLE o Serial:

```text
GOTO:40.4167754,-3.7037902
```

El firmware del robot debe parsear ese comando y navegar hasta la latitud/longitud recibida. El movil solo guarda y envia el destino; la autonomia final depende del codigo del robot, su GPS/brujula o de que el movil siga montado aportando posicion.

## Publicar en GitHub Pages

El proyecto incluye un workflow en `.github/workflows/deploy.yml`. Al hacer push a `main`, GitHub Actions instala dependencias, ejecuta `npm run build` y publica la carpeta `dist` en GitHub Pages.

En GitHub, configura Pages para usar `GitHub Actions` como origen de despliegue.

## BLE UART compatible

La app muestra cualquier periferico BLE que el navegador detecte y, al conectar, prueba varios perfiles UART comunes:

- Nordic UART:
  - Servicio: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
  - Caracteristica RX: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- HM-10 / AT-09:
  - Servicio: `0000ffe0-0000-1000-8000-00805f9b34fb`
  - Caracteristica RX/TX: `0000ffe1-0000-1000-8000-00805f9b34fb`
- JDY / BT05:
  - Servicio: `0000ffe5-0000-1000-8000-00805f9b34fb`
  - Caracteristica RX/TX: `0000ffe9-0000-1000-8000-00805f9b34fb`

Una app movil de escaneo BLE puede mostrar dispositivos que la web no puede usar para controlar el robot. Web Bluetooth solo funciona con BLE y necesita una caracteristica GATT de escritura; si el modulo es Bluetooth clasico como HC-05/HC-06, usa el modo `Serial HC-05 / HC-06`.

El navegador escribe lineas de texto terminadas en `\n`. El ESP32 acumula caracteres hasta el salto de linea, parsea `<x>,<y>` para el joystick o `GOTO:<lat>,<lon>` para destinos guardados.

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

void goToDestination(double latitude, double longitude) {
  // Implementa aqui la navegacion autonoma del robot hacia el destino.
  // Necesitaras posicion actual, rumbo y control de motores.
}

void parseCommand(String line) {
  line.trim();

  if (line.startsWith("GOTO:")) {
    int commaIndex = line.indexOf(",");
    if (commaIndex < 0) return;

    double latitude = line.substring(5, commaIndex).toDouble();
    double longitude = line.substring(commaIndex + 1).toDouble();
    goToDestination(latitude, longitude);
    return;
  }

  int commaIndex = line.indexOf(",");
  if (commaIndex < 0) return;

  float x = line.substring(0, commaIndex).toFloat();
  float y = line.substring(commaIndex + 1).toFloat();
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
