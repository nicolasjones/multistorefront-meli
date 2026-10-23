# Implementation Plan: Consultas y ventas · Consultas bandeja y aviso

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-122 · **Alcance de entrega**: `refine`, `supabase` (+ `kestra` solo si lo exige la Decisión abierta 4).

## Resumen

Una tabla `dominio.consultas` que solo se llena por `publico.crear_consulta_publica` (la empresa sale del dominio de la tienda), una pantalla Refine de bandeja con diálogo de detalle (estado, responsable, nota interna) y un aviso por correo encolado en la misma transacción del alta y enviado por una Edge Function con reintentos.

## Contexto técnico

Refine + MUI en `apps/web`; Supabase self-hosted (migraciones en `supabase/migrations`, Edge Functions en `supabase/functions`); correo por `supabase/functions/_shared/correo.ts` (SMTP, Mailpit en local). Reutiliza: `private.nivel_seccion('consultas')` y la matriz de roles (ya sembrada), `private.empresas_accesibles()`, `private.insertar_actividad`, `publico.tienda_por_dominio` como modelo de RPC pública, el kit de panel (`EncabezadoPagina`, estados vacío/error/carga), `destinosPanel.ts` (grupo `canales` ya existente) y el patrón pgTAP de aislamiento. **No existe** en el repo: filtros/búsqueda/paginación de listas, contador en el menú, correo de negocio ni cola de avisos; se construyen mínimos.

## Revisión de la Constitución

- **I Aislamiento**: RLS por organización y empresa en las 3 tablas; sin service-role en el navegador; la RPC pública no recibe `empresa_id` del cliente.
- **II Especificar antes**: spec con matriz pantalla↔criterios y flujos.
- **III Idempotente y auditable**: aviso único por consulta (`consulta_id` único), reintentos con tope, `ultimo_error`, eventos en `registro_actividad`.
- **IV Despliegues independientes**: Refine y Supabase; ningún Compose raíz.
- **VI Panel operable**: ubicación (Canales, primero), icono, rutas `/consultas` y `/consultas?consulta=<id>`, estados de carga/vacío/error/éxito, 320/768/1440 px, sin identificadores técnicos visibles.
- **VII Esquemas**: `consultas`, `consultas_configuracion`, `consultas_avisos` → `dominio`; RPC pública en `publico`; vista y RPC internas en `public` (sin datos). Re-verificar en cada tarea de migración, pgTAP y revisión de PR.
- **VIII Empresa activa**: FR-008 y test SC-003.

## Migraciones (todas aditivas; reversión explícita, en migración posterior)

| Migración | Historia | Reversión |
|---|---|---|
| `20261024100000_consultas.sql` | F-CON-01 | `drop table dominio.consultas` (solo después de revertir F-CON-03) |
| `20261024100100_crear_consulta_publica.sql` | F-CON-01 | `drop function publico.crear_consulta_publica(...)` y quitarla de la lista de RPC de `anon` |
| `20261024100200_actualizar_consulta.sql` | F-CON-01 | `drop function public.actualizar_consulta(...)` |
| `20261024100300_consultas_bandeja.sql` | F-CON-01 | `drop view public.consultas_bandeja`; `drop function` de las dos RPC |
| `20261024200000_consultas_configuracion.sql` | F-CON-03 | `drop function` de la RPC y de `private.correo_avisos_consulta`; `drop table dominio.consultas_configuracion` |
| `20261024200100_consultas_avisos.sql` | F-CON-03 | `drop trigger` y `drop table dominio.consultas_avisos` |

Ninguna migración destruye algo que cree otra del mismo PR; cada historia trae la suya y no se encadenan entre sí más allá del objeto ya mergeado.

## Decisiones de diseño

- **Alta solo por RPC pública** (`security definer`): la tabla no admite insert desde la app; el rol `anon` no toca tablas. La función entra a la lista blanca de `anon` del pgTAP (un único cambio en esa prueba).
- **Empresa por dominio**: `publico.crear_consulta_publica` reutiliza la resolución de `dominio.tiendas`/`normalizar_host`; host desconocido y empresa inactiva dan el mismo error.
- **Estados**: `check` fijo de tres valores (editables = F-CFG-01, posterior). Transiciones libres y manuales.
- **Aviso**: cola `consultas_avisos` escrita por disparador en la misma transacción (sin pérdida), envío fuera de la transacción por Edge Function idempotente. Un fallo de correo no afecta a la consulta.
- **Destinatario**: `consultas_configuracion.correo_avisos` o, si no existe, `empresas.correo` (propuesta de la épica: campo propio con el contacto como valor inicial).
- **Bandeja «en 5 s»**: la consulta está en la base apenas la RPC responde; la pantalla la ve al cargar o volver a enfocar (sin tiempo real, no pedido).
- **Responder**: enlace `mailto:`/WhatsApp; el panel no envía mensajes al visitante.

## Riesgos

- **Disparo del aviso** (`pg_net`/webhook en Supabase self-hosted): verificar disponibilidad en la primera tarea de F-CON-03 (T015/T020); plan B, flow de Kestra.
- **Proveedor y dominio de correo (SPF/DKIM)**: operativo, fuera del código; sin él los avisos pueden caer en spam.
- **Datos personales sin política de retención**: se documenta en `docs/consultas.md`; no se borra nada.
- **Spam hacia la RPC pública**: la defensa (campo trampa, límite por IP) es de Tiendas online; aquí solo validación y límites de largo. Riesgo transferido y anotado.
- **Rol por empresa** (MSF-121): si el nivel de sección pasa a ser por empresa, `consultas` debe leerlo de ahí; la RLS usa `private.empresas_accesibles()` y `private.nivel_seccion`, que se re-verifican al mergear MSF-121.

## Estructura de archivos

```
supabase/migrations/20261024*_consultas*.sql
supabase/tests/database/consultas.test.sql, consultas_aviso.test.sql
supabase/functions/enviar-aviso-consulta/{index,handler,contenido}.ts
apps/web/src/lib/consultas.ts, hooks/useConsultas.ts
apps/web/src/pages/consultas/list.tsx
apps/web/src/components/consultas/{DetalleConsulta,...}.tsx
apps/web/src/components/navegacion/destinosPanel.ts (ítem Consultas en Canales)
apps/web/src/pages/empresas/ (campo Correo para avisos de consultas)
docs/consultas.md
```
