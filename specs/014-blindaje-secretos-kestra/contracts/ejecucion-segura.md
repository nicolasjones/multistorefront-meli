# Contrato: ejecución segura de un worker

Este contrato sustituye el paso de `CREDENCIAL` por `docker run` desde Kestra.
Aplica a `plantilla-generico.yml`, `plantilla-dedicado.yml` y a todo worker de
integración futuro.

## Entrada no sensible del despacho

Kestra puede entregar solamente:

| Variable | Uso |
|---|---|
| `ORGANIZACION_ID` | Identidad de la organización. |
| `SISTEMA_EXTERNO` | Selección del conector. |
| `CONEXION_ID` | Identificador usado por el worker al pedir la credencial. |

El comando, input, output, metadata y stdout/stderr del flow no contendrán
`CREDENCIAL`, `credencial`, el valor descifrado ni sus variantes.

## Recuperación dentro del worker

1. El host inyecta al contenedor, fuera de Kestra, la configuración de base de
   datos del rol `worker_<organizacion_id>` mediante su archivo local
   `/opt/automation-platform/worker.env`, consumido por `docker run --env-file`.
   Cada host tiene su propio archivo ignorado por Git; Kestra solo transmite la
   ruta constante, nunca su contenido.
2. El worker invoca `private.obtener_credencial_para_worker(CONEXION_ID)`.
3. Usa el valor solo para autenticarse contra el sistema externo y lo descarta
   al terminar el intento.
4. El worker no serializa el valor ni lo añade a excepciones, métricas, traces,
   stdout o stderr.

## Resultado y error

| Caso | Salida permitida |
|---|---|
| Éxito | Código 0 y referencias operativas no sensibles. |
| Credencial inválida | stderr: `CREDENCIAL_INVALIDA:<conexion_id>`; código distinto de 0. |
| Falla técnica | Código distinto de 0 y causa sanitizada. |

Antes de emitir o persistir una causa, el worker reemplaza el valor literal de
la credencial actual y sus variantes URL/Base64 comunes por `[REDACTADO]`.

Kestra usa la marca para clasificar, pero pasa a `private.procesar_falla_orquestacion`
solo `organizacion_id`, `conexion_id`, tipo y un motivo sanitizado explícito;
nunca el resultado de `errorLogs()`.

## SSH

Los flows autentican contra el host con
`{{ secret('ORQUESTACION_SSH_PRIVATE_KEY') }}`. La clave pública correspondiente
se instala durante el aprovisionamiento de cada host. La clave privada vive
solo en `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` (Base64) del entorno de Kestra y
no se versiona.
