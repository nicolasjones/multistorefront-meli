# Quickstart: validar la observabilidad de workers

## Prerrequisitos

- Stack local del template: `pnpm dev:supabase` y `pnpm dev:kestra`
  (proyecto `automation-platform-template-kestra-dev`) con la clave SSH de
  orquestación configurada (spec 014) y un superadmin sembrado.

## Validación estática

```sh
pnpm test:kestra:evidencia      # contrato de las plantillas y la limpieza
pnpm test:kestra:runtime        # endurecimiento de despacho sin regresión
pnpm infra:config:kestra
```

## Validación real en Kestra

```sh
pnpm test:kestra:evidencia:e2e
```

Escenarios esperados:

1. Genérico, dos organizaciones, evidencia habilitada por input: `SUCCESS`,
   capturas por organización en `publicar_evidencia`, archivo de logs en
   `publicar_logs`, host sin archivos residuales.
2. Dedicado, falla técnica con evidencia: alerta técnica igual que sin
   evidencia y captura del fallo publicada.
3. Dedicado, falla de captura del worker: `SUCCESS` con evento
   `evidencia/fallida` en logs.
4. Dedicado sin evidencia: `SUCCESS`, sin `publicar_evidencia` ejecutada.
5. Limpieza con 30 días: no borra nada reciente; con 0 días: borra la
   evidencia de las ejecuciones anteriores; segunda corrida: 0 archivos; las
   ejecuciones y sus logs siguen consultables.
6. Ningún centinela secreto en logs, outputs ni capturas.

`pnpm test:kestra:secretos:e2e` debe seguir pasando (evidencia deshabilitada
por defecto).
