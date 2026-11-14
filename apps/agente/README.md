# KONTIVA ERP · agente local del PDV

Programa pequeño que se instala en la computadora de cada caja. El PDV (en el navegador) le envía el ticket
y la orden de abrir el cajón; el agente lo imprime en la impresora térmica con comandos ESC/POS
(Epson y compatibles: Bematech, Daruma, Elgin, Xprinter, 3nStar…), con tildes y ñ (página PC850),
el QR del KuDE impreso por la propia impresora, corte de papel y pulso al cajón.

También lee el peso de una **balanza** conectada por cable serie (RS-232 o USB-serie) o por red, para los
productos que se venden por kilo.

El lector de código de barras no necesita el agente: funciona como teclado. Las balanzas que imprimen
etiquetas tampoco: el PDV lee el código de la etiqueta (Empresa → Balanza).

## Instalación

- **Windows**: descargar `kontiva-agente-windows` (artefacto de la integración continua: `kontiva-agente.exe`,
  un solo archivo que no necesita Node.js) y ejecutar
  `powershell -ExecutionPolicy Bypass -File instalar-windows.ps1`: lo copia, lo deja iniciando con Windows
  (sin ventana) y muestra la clave.
- **Linux**: `pnpm --filter @kontiva/agente empaquetar` genera `ejecutable/kontiva-agente`; o con Node.js 22,
  copiar `dist/` a `~/kontiva-agente/` y el servicio `instalar/kontiva-agente.service` a
  `~/.config/systemd/user/`.

La primera vez crea la configuración con una clave nueva y la muestra en pantalla:

- Windows: `%APPDATA%\kontiva-agente\config.json`
- Linux/macOS: `~/.config/kontiva-agente/config.json`

```json
{
  "puerto": 9420,
  "token": "clave-generada",
  "origenes": ["https://su-dominio-del-erp"],
  "impresora": { "tipo": "red", "host": "192.168.1.100", "puerto": 9100 },
  "ancho": 48
}
```

Impresora (`impresora.tipo`):

| tipo | uso |
| --- | --- |
| `red` | impresora con Ethernet o Wi-Fi (`host`, `puerto` 9100) |
| `windows` | impresora USB instalada y **compartida** en Windows (`nombre` del recurso compartido) |
| `cups` | impresora instalada en Linux o macOS (`nombre`) |
| `archivo` | dispositivo directo (`ruta`, ej. `/dev/usb/lp0`) |

`ancho`: 48 columnas para papel de 80 mm, 32 para 58 mm. `origenes`: la dirección del ERP; vacío acepta
cualquiera que tenga la clave.

Balanza (opcional, `balanza`):

```json
"balanza": { "tipo": "serie", "puerto": "COM3", "baudios": 9600, "protocolo": "pedido", "decimales": 3 }
```

| campo | uso |
| --- | --- |
| `tipo` | `serie` (`puerto`: `COM3` en Windows, `/dev/ttyUSB0` en Linux), `red` (`host`, `puerto`) o `prueba` (`kg` fijo) |
| `baudios` | velocidad del puerto, la del manual de la balanza (9600 por omisión; 8 bits, sin paridad, 1 bit de parada) |
| `protocolo` | `pedido`: el agente envía ENQ y la balanza responde (Toledo, Filizola, Urano y la mayoría en modo PDV); `continuo`: la balanza transmite todo el tiempo |
| `decimales` | si el peso llega sin punto (`01234`), cuántos dígitos son decimales: 3 = gramos |

Si la balanza informa peso inestable, negativo o sobrecarga, el PDV muestra el aviso y no carga la cantidad.

En el PDV: botón **Impresora** → dirección `http://127.0.0.1:9420` y la clave → *Imprimir prueba* → *Guardar*. Con balanza: marcar
*Leer el peso de la balanza* y *Probar balanza*. Al agregar un producto por kilo, el PDV pide el peso; el botón
de la balanza en la línea lo vuelve a leer.

## Seguridad

Escucha solo en 127.0.0.1. Cada pedido lleva la clave del equipo (comparación en tiempo constante) y se
verifica el origen. Responde la verificación de red privada de Chrome para que la página https del ERP pueda
usarlo. No guarda tickets ni datos de la empresa.

KONTIVA ERP · Desarrollado por Araújo Tech Sistemas
