# Service técnico · Impresión de orden de ingreso y remito de entrega

Spec: `specs/20261022-100000-service-listado-items-e-impresion/` (F-SVC-07, FR-040…FR-047, SC-006).

## Vistas y rutas

| Documento | Ruta | Disponible |
|-----------|------|------------|
| Orden de ingreso | `/service-tecnico/reparaciones/:id/orden` | Toda reparación |
| Remito de entrega | `/service-tecnico/reparaciones/:id/remito` | Solo reparaciones **entregadas** y no anuladas; si no, «Remito no disponible» |

Se abren desde el detalle de la reparación con «Imprimir orden» (siempre) e «Imprimir remito» (solo entregadas). Ambas rutas cargan de forma diferida (`lazy`) y van dentro de `RequiereServiceTecnico`: exigen `lectura` en `service_tecnico` (quien solo lee puede imprimir) y, sin permiso, muestran «Acceso restringido».

## Contenido

- **Orden de ingreso**: tienda (nombre y los datos de contacto cargados), número `R-000N`, fecha de ingreso, cliente y contacto, equipo, N.º de serie, accesorios, falla, técnico, entrega prevista y bloque de condiciones. **Sin importes.**
- **Remito**: los mismos datos de la orden, tablas de mano de obra y repuestos con subtotales, **total sin IVA**, fecha de entrega y quién entregó. Sin ítems muestra «Sin ítems».
- Ningún documento contiene costos internos ni ganancia, tenga o no `ver_costos` quien imprime (`lib/documentosReparacion.ts` no lee esos campos).

## Cómo se imprime

`DocumentoA4` arma la hoja con `@page { size: A4 }` y `@media print` que oculta barra superior, menú lateral y botones (`.no-imprimir`). El botón «Imprimir» llama a `window.print()`. No hay PDF generado en el servidor ni mecanismo compartido con Ventas (MSF-213): es una vista propia de Service.

## Datos y permisos

- Lee solo `obtener_reparacion` (sin RPC nueva ni migración), `dominio.empresas` (nombre, dirección, WhatsApp, correo; lo no cargado se omite) y `tecnicos_de_service` para el nombre del técnico (si falla, el documento sale con «Sin asignar»).
- La visibilidad por tienda la aplica la base (RLS), no la pantalla.

## Límites

- **Documento no fiscal**; los importes son **sin IVA** (ARS).
- El **texto de condiciones** no está definido (decisión abierta 3 de la spec): mientras no exista, la orden de ingreso no imprime esa línea (MSF-614). Se define en `CONDICIONES_SERVICIO` (`apps/web/src/lib/documentosReparacion.ts`).
- **CUIT y domicilio fiscal** no existen hoy en `dominio.empresas`: no se imprimen ni se inventan.
