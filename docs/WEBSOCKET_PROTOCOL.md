# Protocolo WebSocket — ArchTrace

Versión: `TEACHER_CANVAS_v1`

Transporte: frames de texto JSON sobre WebSocket. Por defecto la extensión escucha en `ws://127.0.0.1:8080`.

Todos los mensajes comparten este sobre:

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "<ACTION>",
  "payload": {}
}
```

Las líneas son **1-based**: la primera línea de un archivo es la línea 1.

## Valores por defecto

Si el campo se omite en `NAVIGATE_TO_CODE`:

| Campo | Valor por defecto |
| --- | --- |
| `highlightColor` | `rgba(59, 130, 246, 0.3)` |
| `focusEditor` | `true` |

## Mensajes

### 1. `NAVIGATE_TO_CODE` (Canvas → IDE)

El canvas pide al IDE que abra un archivo y marque un rango de líneas.

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "NAVIGATE_TO_CODE",
  "payload": {
    "filePath": "src/rag/vector_store.py",
    "range": {
      "startLine": 14,
      "endLine": 45
    },
    "highlightColor": "rgba(59, 130, 246, 0.3)",
    "focusEditor": true
  }
}
```

Reglas del payload:

- `filePath`: string no vacío.
- `range.startLine` y `range.endLine`: enteros ≥ 1.
- `endLine` ≥ `startLine`.
- `highlightColor` y `focusEditor` son opcionales.

### 2. `IDE_STATE_CHANGED` (IDE → Canvas)

El IDE informa del archivo activo, la línea del cursor y si el buffer está limpio o sucio.

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "IDE_STATE_CHANGED",
  "payload": {
    "activeFile": "src/rag/vector_store.py",
    "cursorLine": 22,
    "status": "dirty"
  }
}
```

`status` es `"clean"` o `"dirty"`. `cursorLine` es 1-based.

Al conectar un cliente, la extensión envía un `IDE_STATE_CHANGED` con el estado actual del editor.

### 3. `CLEAR_HIGHLIGHTS` (Canvas → IDE)

El canvas pide al IDE que retire los resaltados. El payload está vacío.

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "CLEAR_HIGHLIGHTS",
  "payload": {}
}
```

Un mensaje inválido (JSON roto, `protocol` distinto de `TEACHER_CANVAS_v1`, acción desconocida o payload mal formado) se ignora y se registra. El socket no se cierra. Un `REQUEST_PROJECT_MAP` con `requestId` vacío, con espacios o de más de 64 caracteres se ignora igual.

### 4. `REQUEST_PROJECT_MAP` (Canvas → IDE)

El canvas pide el índice del workspace. La respuesta se envía solo al cliente que preguntó, no por broadcast.

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "REQUEST_PROJECT_MAP",
  "payload": { "requestId": "scan_1" }
}
```

`requestId` coincide con `^[A-Za-z0-9_-]{1,64}$`.

### 5. `PROJECT_MAP` (IDE → Canvas)

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "PROJECT_MAP",
  "payload": { "requestId": "scan_1", "map": { "version": 1 } }
}
```

`map` es un `ProjectMap`. El `requestId` es el de la petición.

### 6. `PROJECT_MAP_ERROR` (IDE → Canvas)

Si el índice falla, la extensión responde a ese cliente:

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "PROJECT_MAP_ERROR",
  "payload": { "requestId": "scan_1", "message": "No hay una carpeta de workspace abierta." }
}
```

### 7. `SOURCE_FILES_CHANGED` (IDE → Canvas)

La extensión vigila los archivos fuente del workspace (`**/src/**/*.{py,js,jsx,ts,tsx,mjs,cjs}`) y, cuando se crean,
modifican o borran, avisa por broadcast a todos los clientes. Los cambios se agrupan con un debounce de ~400 ms y las
rutas se deduplican.

```json
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "SOURCE_FILES_CHANGED",
  "payload": {
    "changedPaths": ["src/rag/chunker.py"],
    "changedAt": "2026-09-26T10:00:00.000Z"
  }
}
```

Reglas del payload:

- `changedPaths`: entre 1 y 200 rutas relativas al workspace, con `/` como separador. Sin rutas absolutas, `..`
  ni `\`. Los archivos fuera del workspace nunca se envían.
- `changedAt`: fecha ISO 8601 del último cambio del lote.

Al recibirlo, el canvas muestra un aviso, vuelve a pedir el `PROJECT_MAP`, actualiza los bloques de código de los
módulos afectados e invalida las lecciones en caché que apuntan a esos archivos.

## Comportamiento ante errores

Un mensaje inválido (JSON roto, `protocol` distinto de `TEACHER_CANVAS_v1`, acción desconocida o payload mal formado) se ignora y se registra. El socket no se cierra.

`EADDRINUSE` no tumba la extensión: se muestra un aviso de error y el host sigue en marcha.

## Seguridad

- El servidor hace bind solo a `127.0.0.1`. No escucha en `0.0.0.0`.
- Allowlist de `Origin`. Un cliente navegador debe enviar un `Origin` presente en `archtrace.allowedOrigins` (antes `teachercanvas.allowedOrigins`, que se sigue leyendo) (por defecto `http://localhost:3000` y `http://127.0.0.1:3000`). Sin cabecera `Origin` (cliente que no es un navegador) la conexión se acepta. Cualquier otro origen se rechaza en el handshake.
- `filePath` queda restringido al workspace abierto. Una ruta fuera del workspace no se abre en el editor.
