# Modelo de datos: outbox de ejecuciones

## Orden de despacho

| Campo | Regla |
|---|---|
| `id` | Identificador inmutable. |
| `ejecucion_id` | Único; referencia una ejecución. |
| `organizacion_id` | Copiado para aislamiento. |
| `estado` | `pendiente`, `reclamada`, `completada`, `agotada`, `cancelada`. |
| `intentos` | Aumenta solo al reclamar. |
| `reclamada_en` / `vence_en` | Recuperan reclamos abandonados. |
| `ultimo_error_sanitizado` | Sin secreto ni log crudo. |

## Invariantes

- Una orden por ejecución.
- Un estado terminal no vuelve a pendiente.
- Cerrar la ejecución sigue siendo responsabilidad del worker/flow.
- La orden no contiene credenciales, URL ni comando.
