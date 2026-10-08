# Guía de validación: blindaje de secretos

Consulta el [modelo de datos](./data-model.md) y el
[contrato de ejecución](./contracts/ejecucion-segura.md) antes de probar.

## Prerrequisitos

- Dependencias instaladas con `pnpm install`.
- Supabase local activo: `pnpm dev:supabase`.
- Kestra local activo: `pnpm dev:kestra`.
- Clave pública de orquestación instalada en el host de prueba y su privada
  configurada únicamente en `infra/kestra/.env` como
  `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` codificada en Base64.
- Una organización, conexión y worker de fixture. La credencial es el
  centinela no productivo `CENTINELA_014_NO_PERSISTIR`.

## Validación SQL y de configuración

1. Ejecutar `pnpm test:db` y confirmar que la prueba de orquestación comprueba:
   - el rol de worker propio puede obtener solo su conexión;
   - otro worker, `kestra_orquestacion`, `authenticated` y `anon` no pueden;
   - no tienen `SELECT` sobre Vault ni tablas de conexiones.
2. Ejecutar `pnpm infra:config` para validar que `infra/kestra/compose.yaml`
   resuelve sin exponer un valor real.

## Recorrido de ejecución

1. Importar ambas plantillas de flow y disparar una ejecución genérica y una
   dedicada contra el fixture.
2. Provocar una ejecución exitosa, una falla técnica y una falla de credencial;
   repetir esta última para ejercitar el reintento.
3. En cada ejecución, revisar inputs, outputs, logs, error logs, metadata y
   archivos internos/temporales disponibles de Kestra. Buscar el centinela, su
   forma URL-encoded y Base64: cada búsqueda debe devolver cero resultados.
4. Consultar `alertas`: debe haber organización, conexión, tipo y motivo
   sanitizado. La falla de credencial conserva
   `CREDENCIAL_INVALIDA:<conexion_id>` como clasificación, no el centinela.
5. Confirmar que una ejecución de una segunda organización no modifica ni
   expone la conexión de la primera.

## Validación de calidad

```powershell
pnpm lint
pnpm build
pnpm infra:config
pnpm test
```

`pnpm test` requiere Supabase local activo. Nunca copiar el centinela a una
issue, commit, output de CI o archivo versionado; eliminar fixtures locales al
cerrar el recorrido.

## Evidencia del recorrido (T018/T019)

Ejecutado localmente el 2026-09-15 contra Kestra `v1.3.35` con dos
organizaciones de fixture y las tres variantes de conector
(`fixture-exito`, `fixture-tecnica`, `fixture-credencial`):

- **Éxito, dos organizaciones**: ejecución de `plantilla-generico` con ambas
  organizaciones en paralelo → `SUCCESS`.
- **Falla técnica**: ejecución de `plantilla-dedicado` → tarea SSH falla tras
  3 reintentos (`retry: exponential`), `clasificar_y_alertar` resuelve
  `evaluationResult=false` y dispara `alertar_tecnica`; `alertas` registra
  `tipo=tecnica`, `motivo=FALLA_TECNICA_SANITIZADA`.
- **Falla de credencial + reintento**: mismo flujo con `fixture-credencial` →
  3 reintentos, `clasificar_y_alertar` resuelve `evaluationResult=true` y
  dispara `alertar_credencial`; `alertas` registra `tipo=credencial`,
  `motivo=CREDENCIAL_INVALIDA:<conexion_id>`.
- **Búsqueda del centinela**: `grep` del valor literal `CENTINELA_014_NO_PERSISTIR`
  y su variante Base64 sobre outputs y logs de las 5 ejecuciones (vía API de
  Kestra) y sobre `/app/storage` y `/tmp/kestra-wd` dentro del contenedor de
  Kestra → **cero resultados** en todos los casos. `alertas.motivo` contiene
  únicamente las clasificaciones sanitizadas, nunca el centinela.
- **Aislamiento**: cada organización de fixture despachó contra su propio
  host SSH y su propio `worker_<organizacion_id>`; la Fase 2 (pgTAP) ya cubre
  el rechazo cruzado a nivel de rol.
- Fixtures locales (contenedores, organizaciones, roles `worker_*`, secretos
  de Vault) eliminados al cerrar el recorrido.

Durante este recorrido se corrigieron dos defectos reales encontrados en
ejecución (no solo de fixture) — ver nota de desvío en `tasks.md` bajo T014.

Este recorrido ahora es reproducible con un solo comando:
`infra/kestra/validar-secretos-e2e.mjs` aprovisiona el fixture, dispara las
tres ejecuciones vía la API de Kestra, exporta sus outputs/logs y termina
invocando `test-secretos-orquestacion.mjs --artifact-directory` para verificar
de forma automatizada cero apariciones del centinela (T022; antes esta
evidencia se obtenía con comandos manuales no reproducibles).
