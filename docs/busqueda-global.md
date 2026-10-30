# Búsqueda global de productos (F-INI-03, MSF-374)

Campo en la barra superior (`EncabezadoPanel` → `BusquedaGlobal`), visible en todas las pantallas del panel.

- **Qué busca**: solo productos, por nombre o SKU (decisión D-4 de `specs/20261030-100000-inicio-y-alertas`; clientes y comprobantes quedan fuera).
- **RPC**: `public.buscar_productos_global(p_q text, p_limite int default 8)` devuelve `producto_id, nombre, sku`. `security invoker`: rige la RLS de `dominio.productos` (organización + `productos`≥`lectura`); un rol sin lectura recibe 0 filas. Mínimo 2 caracteres (error `22023`), tope 20. Tolera mayúsculas, tildes y errores leves de tipeo (`private.normalizar_busqueda`, `pg_trgm`, umbral `private.umbral_similitud_busqueda`).
- **Permisos**: `grant execute … to authenticated`, `revoke … from public, anon`.
- **Interfaz**: espera 300 ms tras escribir; elegir un resultado abre `/productos/:id/edit`; sin coincidencias «No encontramos productos»; si falla, `EstadoError` con «Reintentar» sin vaciar el campo. Teclado: flechas, Enter, Escape; una región `role="status"` anuncia la cantidad de resultados.
- **Empresa activa (Principio VIII)**: no aplica; los productos son del catálogo de la organización, no de una empresa.
- **Reversión**: `drop function public.buscar_productos_global(text, integer);` en una migración posterior.
- **Pruebas**: `supabase/tests/database/busqueda_global.test.sql` (pgTAP) y `apps/web/src/components/navegacion/busqueda-global.test.tsx` (Vitest).
