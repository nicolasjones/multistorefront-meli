---
owner: producto
sources: [specs]
---
# Service técnico · Listado de reparaciones con filtros por período (F-SVC-04)

Historia **MSF-342**, épica **MSF-199** · spec en `specs/20261022-100000-service-listado-items-e-impresion/`.
Reemplaza el vacío de la pestaña «Reparaciones» (MSF-182) por el listado paginado con filtros.

## Qué ve la persona del taller

`/service-tecnico/reparaciones` muestra una tabla (tarjetas en móvil) con nueve columnas: **Reparación**
(`R-0238` y «Ingreso dd/mm», enlace al detalle), **Tienda**, **Cliente**, **Equipo** (con el modelo debajo),
**N.º de serie**, **Estado** (chip), **Técnico** (nombre visible, nunca el correo), **Entrega** (prevista) y
**Total** (total al cliente; «A presupuestar» si es cero). Donde falta un dato se ve «—». Arriba a la derecha,
el contador «N reparaciones». «Nueva reparación» solo con `edicion`.

Filtros:

- **Período** (chips Hoy / Semana / Mes, por defecto Mes) sobre la **fecha de entrega prevista**; el subtítulo
  dice «Según la fecha de entrega prevista (hoy: dd/mm/aaaa)».
- **N.º de serie**: coincidencia parcial sin distinguir mayúsculas, con espera de 300 ms al tipear. **Ignora el
  período**, para poder encontrar cualquier reparación.
- **Técnico**: los de `tecnicos_de_service()`.
- **Tienda**: es la **empresa activa de la barra superior** (Principio VIII). No hay chips de tienda en la pantalla.

Cambiar cualquier filtro, o la empresa activa, vuelve a la página 1. Mientras se relee la empresa activa no se
muestran filas (ni las de la empresa anterior ni las de «todas»).

Estados: carga, error con «Reintentar», vacío «No hay reparaciones en este período» y, buscando por serie,
«No hay reparaciones con ese número de serie».

## RPC `public.listar_reparaciones`

`listar_reparaciones(p_empresa, p_periodo, p_serie, p_tecnico, p_pagina, p_tamano) → jsonb`
`{ total_filas, filas[] }` (migración `20261022110200_reparaciones_listar.sql`).

| Parámetro | Regla |
|---|---|
| `p_empresa` | `null` = todas las tiendas accesibles; una tienda ajena o inaccesible devuelve cero filas |
| `p_periodo` | `hoy` (= hoy) · `semana` (hoy … hoy+6) · `mes` (mes calendario en curso **más** las sin entrega prevista); otro valor → `22023` con `hint = periodo`. «Hoy» se calcula en zona Argentina |
| `p_serie` | `like` parcial sobre `lower(numero_serie)`, con `%`, `_` y `\` literales; en blanco = sin búsqueda; si hay serie, el período no se aplica |
| `p_tecnico` | `tecnico_id` exacto |
| `p_pagina`, `p_tamano` | 1-based, tamaño 1…200 (25 por defecto). El total cuenta todas las filas, no las de la página |

Orden: ingreso descendente, luego número descendente. La fila trae `id, numero, codigo, ingreso_en, empresa_id,
empresa, cliente, equipo, modelo, numero_serie, estado, estado_tono, tecnico_id, tecnico, entrega_prevista,
total_cliente`. **Nunca** costos internos ni ganancia.

### Seguridad

- `revoke … from public, anon` y `grant execute … to authenticated`. Sin sesión → sin ejecución.
- **Desvío de la spec (FR-001 pedía `security invoker`)**: la función es `security definer`, como
  `obtener_reparacion`, porque el cliente vive en `public.clientes`, cuya RLS exige la sección *Clientes*; un rol
  de Service sin esa sección vería el listado vacío. La función aplica a mano el mismo límite que la RLS de
  `reparaciones`: organización del llamador (`private.organizacion_id()`), al menos `lectura` en `service_tecnico`
  (si no, `42501`) y tiendas de `private.empresas_accesibles()`. Con `search_path = ''`.
- Aislamiento entre organizaciones y por tienda cubierto en `supabase/tests/database/service_listado.test.sql`.

## Índices (migración `20261022110100_reparaciones_listado_indices.sql`)

- `reparaciones_org_empresa_entrega_idx (organizacion_id, empresa_id, entrega_prevista)`: tienda + período.
- `reparaciones_org_serie_idx (organizacion_id, lower(numero_serie)) where numero_serie is not null`: sirve a la
  búsqueda **exacta** por serie. La búsqueda **parcial** (`%texto%`) no puede usar un índice btree: recorre las
  filas de la organización, que con 2.000 reparaciones por organización alcanza (SC-002). Si dejara de alcanzar,
  se evalúa un índice trigram en una migración aditiva (sin extensión nueva hoy: Principio V).
- `reparaciones_tecnico_idx` ya existía (MSF-182).

## Volumen (SC-002)

`supabase/tests/database/service_listado_volumen.test.sql` siembra 2.000 reparaciones en tres tiendas y dos
técnicos, mide una página de Mes, de Semana por tienda y de búsqueda por serie (umbral provisorio **< 500 ms**,
*Decisiones abiertas* 5) y comprueba con `explain` (con `enable_seqscan = off`, porque con 2.000 filas el
planificador prefiere el barrido secuencial aunque el índice sirva) que cada índice es utilizable. Se corre con
`pnpm test:db` (requiere `pnpm dev:supabase`).

## Reversión

Las dos migraciones son aditivas. Para volver atrás, en una migración posterior:

```sql
drop function public.listar_reparaciones(uuid, text, text, uuid, integer, integer);
drop index dominio.reparaciones_org_empresa_entrega_idx;
drop index dominio.reparaciones_org_serie_idx;
```

y restaurar `pages/service-tecnico/reparaciones.tsx` de MSF-182 (solo «Nueva reparación»). No hay datos que
migrar.

## Fuera de alcance (matriz de la spec)

KPIs «En reparación / Listas para entregar / Esperando repuesto» (MSF-124), chips de tienda dentro de la
pantalla, mensaje de éxito (el listado no ejecuta acciones). Diferencia con el prototipo anotada en el PR: el vacío
dice «No hay reparaciones en este período» (la épica) y no «Sin entregas en este período».

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
