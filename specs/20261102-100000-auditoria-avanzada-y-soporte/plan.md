# Implementation Plan: Plataforma · Auditoría avanzada y soporte

**Spec**: `specs/20261102-100000-auditoria-avanzada-y-soporte/spec.md` · **Épica**: MSF-170 · **Alcance de entrega**: `refine`, `supabase`, `kestra`

## Resumen

Extiende `registro_actividad` (F-AUD-01) con antes/después, inalterabilidad y depuración; agrega exportación CSV a la pantalla Actividad; y acota/registra el ingreso del superadmin a una organización.

## Constitution Check

- **I / VII (esquemas)**: todas las tablas tocadas son plataforma → `public` (`registro_actividad`, `tipos_evento_actividad` nueva, `superadmin_entradas`, `superadmin_organizacion_activa`); nada en `dominio`. Esquema re-verificado en spec, plan y tareas (T001). RLS: `tipos_evento_actividad` con `select` a `authenticated`; las demás ya tienen RLS y no se agregan policies de escritura. pgTAP recorre `public` + `dominio`.
- **II**: spec con permisos, fallos, auditoría y datos. **III**: auditoría y depuración idempotentes con actor «Sistema». **IV**: Refine + Supabase + Kestra, sin Compose raíz. **V**: sin infraestructura nueva (un flow en la instancia de Kestra existente).
- **VI**: no hay destino de menú nuevo: «Actividad» (`/actividad`) ya existe; el detalle es un diálogo (carga diferida) y los diálogos de soporte viven en Organizaciones. 320/768/1440 px, teclado y lector de pantalla; sin UUID visibles.
- **VIII (empresa activa)**: el export y el detalle respetan la empresa activa (FR-013, FR-007); Organizaciones (superadmin) no aplica, justificado en la matriz.
- **Supabase self-hosted**; migraciones aditivas con reversión en el encabezado. Documentación en `docs/` (Documentación obligatoria).

## Piezas y archivos

| Pieza | Archivos (previstos) |
|---|---|
| F-AUD-02 BD | `supabase/migrations/20270210100000_registro_inalterable_antes_despues.sql`, `20270210100100_depurar_registro_actividad.sql`, pgTAP `registro_inalterable.test.sql` y `depurar_registro_actividad.test.sql` |
| F-AUD-02 Kestra | `infra/kestra/flows/depuracion-actividad.yml` + test de validación del flow (patrón `validar-copias-flows.test.mjs`) |
| F-AUD-02 UI | `apps/web/src/hooks/useDetalleActividad.ts`, `components/DetalleActividadDialog.tsx`, integración en `pages/actividad/list.tsx` |
| F-AUD-03 | `supabase/migrations/20270210110000_exportar_actividad.sql`, `lib/exportarCsv.ts` (reuso), `components/BotonExportarActividad.tsx`, integración en `pages/actividad/list.tsx` |
| F-OPS-04 | `supabase/migrations/20270210120000_acceso_soporte_auditado.sql`, `pages/organizaciones/list.tsx`, `components/OrganizacionActivaBanner.tsx`, `lib/superadmin.ts`, pgTAP `acceso_soporte.test.sql` |

Cada historia trae su propia migración con timestamp propio; ninguna depende de otra. `soporte.*` no usa el mecanismo de «sensible» (no es un cambio de dato con antes/después), por eso F-OPS-04 solo usa `private.insertar_actividad` (firma estable) y es independiente de F-AUD-02.

## Decisiones técnicas

- **Inalterabilidad**: triggers `before update/delete/truncate` + revoke. La excepción de la depuración usa un flag de transacción (`set_config('app.depuracion_actividad','on', true)`) que solo setea `private.depurar_registro_actividad` y que el trigger exige junto con `creado_en` vencido. La excepción de cascada permite el delete solo si la organización ya no existe (se valida con pgTAP; si el motor no lo permite, plan B documentado: flag análogo en la función de borrado de organizaciones).
- **Depuración**: patrón de `purgar_evidencias_ia` (función privada concedida a `workers_orquestacion`) + flow de Kestra; plazo 24 meses como parámetro de la función.
- **Detalle**: RPC aparte (`obtener_detalle_actividad`) para no cambiar el `returns table` de `listar_actividad` (sería BREAKING); la fila se abre por clic o Enter.
- **Export**: RPC en servidor con tope; el CSV se arma en el navegador con `exportarCsv.ts` (neutralización de fórmulas se verifica/agrega ahí con test).
- **Soporte**: `vence_en` + predicado de vigencia en `private.organizacion_id()` y en cada helper que lee `superadmin_organizacion_activa` (T016 lista todos con `graphify`/grep antes de tocar; la base vigente de `organizacion_id()` es la de `20261012140100`). `entrar_a_organizacion` pasa a dos argumentos (BREAKING en `contracts/`).
- **Sin prototipo** para el detalle ni para el acceso de soporte: se resuelven con componentes del template y tokens del sistema de diseño; la diferencia se anota en la descripción del PR.

## Riesgos

- Reescribir `private.organizacion_id()` toca todas las RLS: cubrir con pgTAP (`aislamiento_organizaciones`) y desplegar primero en staging.
- Cascada de borrado de organización vs. trigger de inalterabilidad (ver arriba).
- Registros históricos sin valores: la UI debe tolerarlos.

## Verificación T001 (MSF-259)

Verificado contra las migraciones: `public.registro_actividad` (`20261016120000`), `insertar_actividad`, el trigger `registrar_actividad_membresia`, `guardar_matriz_permisos` (versión vigente en `20261020130100`) y `restablecer_matriz_permisos` existen; `tipos_evento_actividad` no existía. Esquema de cada tabla: `tipos_evento_actividad` → `public` (catálogo transversal); `registro_actividad` → `public` (altera). Nada en `dominio`.

Desvíos de implementación de F-AUD-02: las migraciones llevan las versiones que fijó el runner (`20270201200141`, `20270201200142`) y no las del tasks.md; la depuración se concede también a `kestra_orquestacion` porque es el rol con que corre el flow (ver commit del flow).
