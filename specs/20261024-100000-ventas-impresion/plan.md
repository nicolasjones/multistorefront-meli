# Implementation Plan: Ventas y despacho · Ventas impresión

**Branch**: `epic/MSF-213-ventas-y-despacho-ventas-impresion` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md) | **Contratos**: [contracts/ventas-impresion.md](./contracts/ventas-impresion.md)

## Summary

Tres historias sobre el comprobante de MSF-159: (F-VTA-19) imprimir factura y remito como PDF A4 generado por un worker; (F-VTA-21) marcar y reimprimir; (F-VTA-20) presupuesto en PDF y envío por correo. Un pedido de documento (`dominio.comprobante_documentos`) se despacha por Kestra (outbox) a un worker que sube el PDF a un bucket privado; la pantalla consulta el estado y abre el archivo con URL firmada.

## Technical Context

- **Lenguaje / stack**: TypeScript. `apps/web` (Refine + MUI), `supabase` (migraciones SQL + pgTAP), `infra/kestra/flows`, `workers/comprobantes-pdf` (Node, mismo patrón que `workers/historial-importador`).
- **Motor de PDF (provisorio, se decide en T006)**: librería de Node pura (sin navegador dentro de la imagen) con A4, fuentes embebidas y paginado; versión **exacta** y `pnpm audit --prod` documentado. Alternativa: render HTML→PDF con Chromium (`playwright-core` ya está en el repo) si el formato final lo exige.
- **Despacho**: patrón de `historial-importador` (`docs/historial-ventas.md`): orden de outbox + `private.reclamar_despachos_capacidad` + ejecución por SSH/Docker. Las funciones exactas de la outbox y el helper de "crear ejecución manual + orden" se **verifican en el árbol al implementar** (`solicitar_importacion_historial` es el modelo).
- **Correo**: tarea `io.kestra.plugin.notifications.mail.MailSend` como `infra/kestra/flows/aviso-fallo-copias.yml`; variables `KESTRA_SMTP_*` ya existen en `infra/kestra/.env.example`. El adjunto lo baja el flow del bucket con una URL firmada de corta vida emitida por el worker/orden (sin exponer la clave de servicio en el flow).
- **Storage**: bucket privado nuevo con políticas sobre `storage.objects` (patrón `tienda-identidad`).
- **Testing**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), tests del worker (`pnpm --filter @workers/comprobantes-pdf test`), render/validación del flow (`pnpm infra:config`), Playwright E2E en el cierre.
- **Restricciones**: una sola plantilla por documento (formato provisorio); sin PDF generado en el navegador; sin secretos en Git (`.env.example` solamente); Compose por producto.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I. Multi-tenant | Tablas nuevas con `organizacion_id` + RLS; bucket privado acotado por organización; el worker usa clave de servicio solo en servidor. |
| II. Especificar antes | Esta spec; plan y tareas referencian FR/SC. |
| III. Idempotencia y auditoría | Pedido idempotente (índice único parcial), reutilización del PDF, cierre idempotente, eventos de actividad, errores sanitizados. |
| IV. Despliegues independientes | Worker propio, flow propio, sin Compose raíz. |
| V. Simplicidad | Sin infraestructura nueva: reutiliza outbox, Kestra, SMTP de Kestra y Storage. |
| VI. Panel operable | Sin pantalla nueva: botones, diálogo y tarjeta dentro de las rutas de MSF-159 (`/ventas/comprobantes/:id`, `/ventas/presupuestos`); estados de carga/vacío/error/éxito del kit; 320/768/1440 px; carga diferida del diálogo. |
| VII. Esquemas | Ver tabla de la spec: `dominio.empresas` (alterada), `dominio.comprobante_documentos`, `dominio.comprobante_impresiones`, `dominio.comprobante_envios_correo` → **`dominio`**; bucket → plataforma. Re-verificar en tareas, implementación y PR. |
| VIII. Empresa activa | FR-014 y FR-028; fila «Empresa activa» en la matriz; tests SC-003 y SC-006. |

## Project Structure

```text
specs/20261024-100000-ventas-impresion/   spec.md · plan.md · tasks.md · contracts/ventas-impresion.md
supabase/migrations/                      20261207130000…, 20261207200100…, 20261208100100… (ver tasks.md)
supabase/tests/database/                  ventas_impresion_*.test.sql
workers/comprobantes-pdf/                 src/{index,datos,pdf,storage}.ts · src/plantillas/{factura,remito,presupuesto}.ts · test/
infra/kestra/flows/                       comprobantes-documentos.yml · comprobantes-correo.yml
apps/web/src/lib/                         ventasImpresion.ts · ventasImpresiones.ts · ventasPresupuestoCorreo.ts
apps/web/src/components/ventas/           ImprimirComprobanteDialog.tsx · DocumentosComprobante.tsx
apps/web/src/pages/ventas/                comprobante.tsx · presupuestos.tsx (se editan, son de MSF-159)
apps/web/src/pages/empresas/edit.tsx      campos Razón social y CUIT
docs/ventas-impresion.md
```

## Decisiones de diseño

1. **Un pedido por documento** (no por clic): la tabla es la fuente de verdad del estado; la pantalla consulta por polling acotado (intervalo y tope declarados en T011) y no deja pedidos huérfanos.
2. **Reutilización del PDF** de factura y remito (comprobante confirmado inmutable); el presupuesto se regenera si cambió después del último PDF (`updated_at` del comprobante > `generado_en`).
3. **El cierre del pedido lo hace una función `private.*` ejecutada por el worker** con su conexión; ninguna RPC de cierre se expone a `authenticated`.
4. **Datos de empresa**: columnas nuevas `razon_social`/`cuit` en la ficha; logo desde `tienda_identidad.logo_ruta`. Lo no cargado se omite.
5. **Latencia**: intervalo del flow reducido a 1 minuto (decisión 5 de la spec); es el principal riesgo de experiencia. Medirlo en el E2E del cierre y, si no es aceptable, llevarlo a Nicolás (alternativa (b)).
6. **Reversión** (migraciones aditivas, documentada en cada encabezado):
   - F-VTA-19: `alter table dominio.empresas drop column razon_social, drop column cuit;` · `drop function` de las RPC · `drop table dominio.comprobante_documentos;` · borrar políticas de storage y el bucket (tras vaciarlo).
   - F-VTA-21: `drop function registrar_impresion, ultimas_impresiones_comprobante;` · `drop table dominio.comprobante_impresiones;`.
   - F-VTA-20: restaurar `solicitar_documento_comprobante` sin `presupuesto` · `drop function enviar_presupuesto_correo, listar_envios_correo_presupuesto, private.cerrar_envio_correo;` · `drop table dominio.comprobante_envios_correo;`.
   Nada se destruye en el mismo PR que lo crea.

## Riesgos

- **MSF-159 sin mergear**: la épica no puede mergear antes; las firmas se verifican contra su rama o `main`.
- **Formato no confirmado** con el cliente: la plantilla provisoria puede cambiar; el costo está acotado a una plantilla por documento.
- **Latencia del despacho** (ver decisión 5) y **SMTP global** de Kestra como remitente (decisión 8 de la spec).
- **Dependencia nueva** del worker (motor de PDF): versión exacta, `pnpm audit --prod` y nota en `docs/ventas-impresion.md`.
- **Egress/red del worker**: como `historial-importador`, la red del host se crea a mano; es un paso operativo documentado.

## Documentación (obligatoria)

`docs/ventas-impresion.md` (modelo, RPC, worker, flows, puesta en marcha, reversión), entrada en `docs/README.md`, `docs/actividad.md` (eventos nuevos) y fila de Ventas en `docs/roadmap-template.md` al cierre. `pnpm docs:check`, `pnpm prototipo:check` y `pnpm matriz:check` deben pasar.
