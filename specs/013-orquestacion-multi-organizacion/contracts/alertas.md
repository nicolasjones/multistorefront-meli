# Contrato: Subflow centralizado de alertas

`infra/kestra/flows/alertas.yml` — invocado por `Subflow` desde el bloque
`errors:` de cualquier flow genérico o dedicado (nunca lógica de
notificación duplicada dentro de esos flows, FR-011).

## Inputs

| Input | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `STRING` (`tecnica` \| `credencial`) | sí | determina la audiencia |
| `organizacion_id` | `STRING` (uuid) | no | ausente para una falla técnica no atada a ninguna organización |
| `conexion_id` | `STRING` (uuid) | no | presente cuando `tipo = credencial` |
| `motivo` | `STRING` | sí | mensaje de la falla (mismo texto que ya arma el bloque `errors:` del flow que llama, ver `respaldo-postgres.yml` como referencia de formato) |

## Comportamiento

1. Inserta una fila en `alertas` vía `private.registrar_alerta(...)`
   (auditoría, Principio III) — sucede siempre, sin importar si la
   notificación real después falla.
2. Resuelve el destino según `tipo`:
   - `tecnica` → únicamente el canal de "quien opera la plataforma"
     (configurable, Assumptions de `spec.md` — variable de entorno con el
     webhook/email destino, no fijado por esta spec).
   - `credencial` → el canal de "quien opera la plataforma" **y** un canal
     por-organización para el administrador de `organizacion_id` (por
     ejemplo, el correo del administrador ya registrado en el template —
     definido en `plan.md`/tareas de implementación, no en este contrato).
3. Si `tipo = credencial`, el estado de `conexion_id` ya quedó en
   `credencial_invalida` antes de invocar este subflow (lo hace el flow
   que llama, no este subflow) — este subflow no vuelve a tocar
   `conexiones`.

## Router HTTP configurado

El subflow usa `KESTRA_ALERTAS_WEBHOOK_URL`. El receptor recibe un JSON con
`tipo`, `organizacion_id`, `conexion_id`, `motivo` y `destinatarios`: para
`tecnica`, `operador_plataforma`; para `credencial`,
`operador_y_administradores_organizacion`. El router resuelve los canales
reales sin que los flows versionados contengan correos, URLs por organizacion
ni secretos de proveedores.

## Qué NO hace este subflow

- No decide reintentos — eso ya pasó en el flow que lo invoca (R7), antes
  de llegar acá.
- No limpia el estado de una conexión — eso es
  `private.marcar_conexion_activa`, llamado por el flow que tuvo éxito,
  nunca por este subflow.
