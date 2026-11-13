---
owner: tecnico
sources:
  - specs
  - code
---

# Empresas: construcción interna (MSF-138)

Guía técnica de la entidad `empresas` y sus pantallas del panel. El lado de producto
(qué resuelve, para quién, límites) está en [Empresas](../empresas.md); la tienda online
de cada empresa, en [Dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md).

## Datos

Tablas, columnas y políticas de RLS en detalle: [Empresas — Esquema y RLS](../empresas.md#esquema-y-rls-constitución-principio-vii).
En el gráfico del DER: `dominio.empresas` (`docs/tecnico/datos.md`), padre de `dominio.tiendas`
(FK compuesta por MSF-147) y referenciada por productos, clientes, comprobantes y reparaciones.

Migraciones aditivas:

| Migración | Qué agrega |
|---|---|
| `supabase/migrations/20261013120000_empresas.sql` | Tabla `dominio.empresas` (`organizacion_id` FK `on delete cascade`, `nombre` no vacío tras `btrim`, `whatsapp`, `correo`, `instagram`, `direccion`, `activa` default `true`), índice por `organizacion_id`, políticas `empresas_select` / `empresas_update` por organización, grants `usage` de `dominio` y `select`/`update` acotado a columnas editables al rol `authenticated`. Sin política INSERT/DELETE: el único camino de alta es la RPC `public.crear_empresa`. |
| `supabase/migrations/20261013130001_empresas_updated_at.sql` | Trigger `empresas_updated_at` con `private.tocar_updated_at()`, para que cada update (incluida pausar/reactivar) deje la marca `updated_at`. |
| `supabase/migrations/20261015110000_alta_de_empresas.sql` | RPC `public.crear_empresa` e índice único de nombre por organización (épica de alta MSF-475, historia F-EMP-03 / MSF-277; nota «Alta de empresas» en la guía de producto). Errores de la RPC: `42501`, `22023`, `23505`; sin tablas nuevas, aditiva. |

Reversión (migración posterior, nunca en el mismo PR): `drop trigger empresas_updated_at`,
`drop function private.tocar_updated_at()`, `drop table dominio.empresas` — ver [Reversión](../empresas.md#reversión).

## Frontend (`apps/web`)

| Ruta / archivo | Qué hace |
|---|---|
| `/empresas` · `src/pages/empresas/list.tsx` | Listado con una fila por empresa (tarjeta en pantallas angostas); columnas de tienda web, Mercado Libre y precio en «Sin configurar», moneda ARS. Estados vacío/error/carga del template. |
| `/empresas/edit/:id` · `src/pages/empresas/edit.tsx` | Datos generales: nombre editable, dominio solo lectura, idioma y moneda fijos, contacto; validación y aviso de cambios sin guardar. |
| Pausa/reactivar | Acción inmediata fuera del formulario: escribe `activa` y marca `updated_at`; el listado refleja el estado. |
| `src/lib/eventosActividad.ts` | Emisión de `empresa.actualizada`, `empresa.pausada`, `empresa.reactivada` (contrato compartido con F-AUD-01); sin destino registrado no hace nada y no revierte la edición. |

El selector de empresa de la barra superior (F-EMP-05) cambia la empresa **por ruta**; la empresa
activa persistida de *Permisos por empresa* (F-ROL-06) es otro selector y sus diferencias están en
[Empresa activa](../empresa-activa.md#límite-con-f-emp-05).

## Pruebas

- pgTAP: `supabase/tests/database/empresas.test.sql` (RLS por organización, permisos de escritura,
  triggers y updated_at; inserta 1, 2 y 3 empresas por organización para no asumir cantidad).
- Vitest: `apps/web/src/pages/empresas/{list,edit}.test.tsx`, `apps/web/src/hooks/useCrearEmpresa.test.tsx`
  y `apps/web/src/components/empresas/DialogoNuevaEmpresa.test.tsx` (esta última pareja, de la épica de alta).
- E2E: listado, edición, pausar/reactivar y cambio de empresa siguen **sin suite Playwright** (fila
  «Empresas» de `docs/e2e-app.md`, deuda trazada en MSF-499).

## Extensión y límites

- Cada épica que agregue una tabla por empresa la suma a `private.copiar_configuracion_empresa` y a su
  prueba pgTAP (punto de extensión de la alta de empresas).
- La acción de pausar la tienda es el mismo interruptor `activa` que usa la tienda pública para mostrar
  «Volvemos pronto»; de detalle en [Tienda pública](tienda-catalogo-y-ficha.md) y
  [Dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md).
- MSF-121 acota el selector y las secciones por empresa con `private.empresas_accesibles()`; la tabla
  `dominio.empresas` mantiene lectura por organización, así que todo usuario ve las empresas de la suya.
  Detalle: [Permisos por empresa](permisos-por-empresa.md).
