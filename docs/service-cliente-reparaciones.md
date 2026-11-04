# Service técnico · Reparaciones en la ficha del cliente (F-SVC-15, MSF-429)

Épica MSF-232, spec `specs/20261028-100000-service-cobro-y-avisos` (FR-040…FR-047).

## RPC `public.reparaciones_de_cliente`

`reparaciones_de_cliente(p_cliente uuid, p_empresa uuid default null, p_pagina int default 1, p_tamano int default 25)` → `{ total_filas, filas[] }`.

- **Esquema**: sin tablas nuevas (Principio VII); lee `dominio.reparaciones`, `empresas`, `modelos_equipo` y `estados_reparacion`, apoyada en `reparaciones_cliente_idx`.
- **Seguridad**: `security definer`, `search_path = ''`. Un rol de Service puede no tener la sección Clientes, así que la función aplica a mano el límite de la RLS de `reparaciones`: organización del llamador, `service_tecnico` en `lectura` o `edicion` (si no, `42501`) y `private.empresas_accesibles()`. `revoke … from public, anon` y `grant execute … to authenticated`.
- **Fila**: `id`, `numero` (`R-0238`), `empresa`, `equipo`, `modelo`, `estado`, `estado_tono`, `ingreso_en`, `entrega_prevista`, `total` (mano de obra + repuestos). Nunca costos internos.
- **Orden y página**: ingreso descendente, luego número descendente; página 1-based, tamaño 1…200 (25 por defecto). Un cliente ajeno o inexistente devuelve vacío.

## Pestaña «Reparaciones» (`/clientes/:id`)

- La ficha tiene las pestañas «Datos» (el contenido previo, sin cambios) y «Reparaciones». La segunda se carga diferida y **no aparece** con `service_tecnico` en `ninguno`; con `lectura` aparece sin acciones de edición.
- Tabla en escritorio y tarjetas en móvil (`ContenidoAdaptable`); cada número lleva a `/service-tecnico/reparaciones/:id`. Total: importe, «A presupuestar» si es cero; «—» si falta Entrega.
- Respeta la empresa activa de la barra superior (Principio VIII): una tienda filtra por ella, «Todas» muestra las accesibles; al cambiarla recarga, vuelve a la página 1 y no muestra filas de la anterior.
- Código: `apps/web/src/lib/reparacionesDeCliente.ts`, `components/clientes/ReparacionesDeCliente.tsx`, `pages/clientes/show.tsx`.

## Pruebas

pgTAP `supabase/tests/database/service_cliente_reparaciones.test.sql` (`pnpm test:db`) y Vitest `apps/web/src/pages/clientes/show.reparaciones.test.tsx` (`pnpm test:web`).

## Reversión

Migración `20270121121000_reparaciones_de_cliente.sql`, aditiva. Para volver atrás: una migración posterior con `drop function public.reparaciones_de_cliente(uuid, uuid, integer, integer);` y retirar la pestaña de `show.tsx`. No hay datos que migrar.
