# Plan de implementación: Consultas y ventas · Contactos y respuestas rápidas

**Épica**: MSF-144 · **Spec**: [spec.md](./spec.md) · **Contrato**: [contracts/contactos.md](./contracts/contactos.md)
**Alcance de entrega**: `refine`, `supabase`.
**Prerrequisitos (ya en `main`)**: `dominio.consultas` + `public.consultas_bandeja` + detalle (`apps/web/src/pages/consultas/`), `armarTextoInicial` (`apps/web/src/lib/textoInicialConsulta.ts`), `dominio.comprobantes_venta` (con `empresa_id`), `private.empresas_accesibles()`, `private.nivel_seccion('consultas')`, `private.insertar_actividad`.

## Esquemas (Principio VII — re-verificar en tareas, implementación y PR)

| Objeto | Esquema | Motivo |
|---|---|---|
| `contactos` | `dominio` | Entidad de negocio con datos personales. |
| `respuestas_rapidas` | `dominio` | Contenido de negocio por empresa. |
| `consultas.contacto_id`, `comprobantes_venta.contacto_id` | `dominio` | Columnas aditivas sobre tablas de dominio. |
| RPC y vistas (`crear_contacto`, …, `respuestas_rapidas_lista`) | `public` | Superficie de lectura/ejecución, sin datos propios. |

## Migraciones (aditivas, con reversión en el encabezado)

F-CON-05:
1. `20270201100000_contactos.sql` — tabla, RLS sin escritura, índices únicos parciales sobre `(empresa_id, correo_normalizado)` y `(empresa_id, telefono_normalizado)` donde `anonimizado_en is null`, `unique (id, organizacion_id)`. Reversión: `drop table dominio.contactos;` (exportar antes: datos personales).
2. `20270201100100_contactos_vinculos.sql` — `contacto_id` nullable + FK compuesta en `consultas` y `comprobantes_venta`; `create or replace view public.consultas_bandeja` con la columna al final. Reversión: quitar FK y columnas, restaurar la vista.
3. `20270201100200_contactos_crear_actualizar.sql` — `crear_contacto`, `actualizar_contacto` (normalización, duplicados, consentimiento, actividad). Reversión: `drop function`.
4. `20270201100300_contactos_vincular.sql` — `vincular_consulta_contacto`, `vincular_comprobante_contacto`. Reversión: `drop function`.
5. `20270201100400_contactos_lectura.sql` — `buscar_contactos`, `historial_contacto`. Reversión: `drop function`.
6. `20270201100500_anonimizar_contacto.sql` — `anonimizar_contacto`. Reversión: `drop function` (los datos ya anonimizados **no** se recuperan: solo por backup).

F-CON-06:
7. `20270201200000_respuestas_rapidas.sql` — tabla + RLS sin escritura. Reversión: `drop table dominio.respuestas_rapidas;`.
8. `20270201200100_respuestas_rapidas_rpc.sql` — vista `respuestas_rapidas_lista`, `guardar_respuesta_rapida`, `eliminar_respuesta_rapida`. Reversión: `drop view` / `drop function`.

Cada historia trae sus propias migraciones y no se encadenan entre sí.

## Frontend (`apps/web`)

- F-CON-05: `src/lib/contactos.ts` (RPC y mapeo de errores), `src/lib/consentimientoContacto.ts` (texto versionado), `src/pages/contactos/{list,ficha}.tsx` + diálogos `CrearContactoDialog`, `AnonimizarContactoDialog`, ruta `/contactos` y ítem `Contactos` en el grupo **Canales** (debajo de Consultas, ícono de contactos; audiencia: `consultas`≥`lectura`; sin ruta anterior que conservar). Detalle de la consulta: `ContactoConsulta.tsx` montado con una línea en el diálogo existente.
- F-CON-06: `src/lib/respuestasRapidas.ts` (lectura + `resolverVariables`), `src/pages/consultas/RespuestasRapidasDialog.tsx` (botón en el encabezado) y selector en el flujo de `Responder`; `armarTextoInicial` recibe la respuesta elegida opcional (sigue siendo el único punto).
- Empresa activa (Principio VIII) por el hook compartido; estados `EstadoCargaPagina`/`EstadoVacio`/`EstadoError`; panel responsive 320/768/1440 px, teclado y lector de pantalla (Principio VI); la ficha carga de forma diferida (fuera del recorrido principal).

## Pruebas

pgTAP `supabase/tests/database/contactos.test.sql` y `respuestas_rapidas.test.sql` (dos organizaciones, dos empresas, roles); Vitest por pantalla/lib; E2E Playwright de la verificación de la épica.

## Documentación

`docs/contactos.md` (modelo, consentimiento, anonimización, permisos, reversión), fila de `docs/roadmap-template.md` al cerrar, `pnpm docs:check`.
