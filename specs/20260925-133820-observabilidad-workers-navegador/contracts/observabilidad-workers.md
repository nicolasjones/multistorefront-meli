# Contrato: observabilidad de workers

Versión normativa en `workers/CONTRATO.md` (sección "Observabilidad y
evidencia visual"); este archivo resume lo que cada parte promete.

## El worker promete

1. Emitir en stdout una línea JSON por cambio de etapa con `etapa`,
   `estado`, `timestamp`, `ejecucion` y `mensaje` (ver `data-model.md`).
2. Escribir en stderr solo errores sanitizados (`CREDENCIAL_INVALIDA:<id>` u
   otro motivo sin secretos).
3. Nunca escribir credenciales, tokens, cookies, contenido de
   `localStorage`/`sessionStorage`, encabezados de autenticación ni URLs con
   secretos en eventos, logs, nombres de archivo o capturas.
4. Con `EVIDENCIA_VISUAL=true`, capturar solo hitos en `EVIDENCIA_DIR`, con
   pantallas sin campos de credencial visibles; con `false` o sin
   `EVIDENCIA_DIR`, no capturar.
5. Si una captura falla, emitir `{"etapa":"evidencia","estado":"fallida",...}`
   y continuar con el mismo resultado de negocio.
6. No borrar evidencia ni leer `EVIDENCIA_RETENCION_DIAS`.

## La plataforma (plantillas de Kestra) promete

1. Pasar `KESTRA_EJECUCION_ID`, `EVIDENCIA_VISUAL` y, si corresponde,
   montar `/evidencia` y pasar `EVIDENCIA_DIR=/evidencia`.
2. Publicar el archivo de logs del despacho (`publicar_logs`) en éxito y en
   error.
3. Con evidencia efectiva, publicar las capturas (`publicar_evidencia`) en
   éxito y en error, por organización, y borrarlas del host.
4. No cambiar el estado de negocio ni la clasificación de alertas por un
   fallo de evidencia.
5. Limpiar diariamente la evidencia vencida (`limpieza-evidencia`) sin tocar
   ejecuciones, logs, métricas ni Supabase.

## Configuración (Kestra, por entorno)

| Variable | Default | Uso |
|---|---|---|
| `EVIDENCIA_VISUAL` | `false` | Habilita capturas; input `evidencia_visual` la reemplaza por ejecución |
| `EVIDENCIA_RETENCION_DIAS` | `30` | Plazo de limpieza y de residuos en host |
| `EVIDENCIA_DIR_HOST` | `/var/lib/automation-platform/evidencia` | Base en el host de despacho, propiedad del usuario SSH |
