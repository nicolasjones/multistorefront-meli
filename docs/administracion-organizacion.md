---
owner: producto
sources:
  - specs
---

# Administración de la organización: datos y configuración

Spec: `specs/20261014-140000-administracion-de-usuarios-y-organizacion/` (F-ORG-03, MSF-253, épica MSF-132).
Migración: `supabase/migrations/20261014160000_organizacion_datos_y_configuracion.sql`.
Pruebas: `supabase/tests/database/organizacion_datos_y_configuracion.test.sql` y
`apps/web/src/pages/organizacion/edit.test.tsx`.

El administrador edita nombre, logo y zona horaria de **su** organización en `/organizacion`
(menú Configuración → «Mi organización», audiencia administrador, dentro de
`RequiereOrganizacionActiva`) y ve la lista de sus empresas con enlace a `/empresas/edit/:id`.
El alta de empresas no se hace acá (MSF-475). La pantalla se construyó con el sistema de diseño
(`docs/sistema-de-diseno.md`); no hay artboard dibujado para F-ORG-03.

## Campos (esquema `public`, tabla `organizaciones`)

| Columna | Tipo | Regla |
|---|---|---|
| `nombre` | `text` (ya existía) | No vacío tras `btrim`, hasta 120 caracteres. |
| `zona_horaria` | `text not null` | Default `America/Argentina/Buenos_Aires`; debe existir en `pg_timezone_names`. |
| `logo_path` | `text` nulo | `<organizacion_id>/<archivo>.png\|jpg\|jpeg\|webp` en el bucket `logos-organizacion`; nulo = sin logo. |

## Escritura: RPC `public.actualizar_organizacion(p_nombre, p_zona_horaria, p_logo_path)`

- `security definer`, `set search_path = ''`. No hay política UPDATE ni `grant update` sobre
  `organizaciones`: el único camino es la RPC.
- La organización la resuelve el servidor con `private.organizacion_id()`; el llamador no la pasa.
- Exige `private.puede_escribir()` (administrador **activo** o superadmin con organización
  activa): operador, consulta y suspendidos reciben `42501`.
- Datos inválidos (nombre vacío o largo, zona inexistente, logo de otra organización o de tipo no
  admitido) → `22023` sin cambios.
- Es un reemplazo de estado: `p_logo_path` nulo quita el logo.
- `revoke execute … from public, anon` y `grant execute … to authenticated` (regla de `CLAUDE.md`
  y `docs/acceso-ingreso.md`).

## Logo: bucket `logos-organizacion`

Privado, solo PNG/JPG/WebP (sin SVG), tope de 1 MB. Las políticas de `storage.objects` exigen que
el prefijo sea el `organizacion_id` de quien llama; lectura para la organización, escritura solo
para `private.puede_escribir()`. Refine muestra el logo con URL firmada de 5 minutos y nunca usa
la service-role en el navegador. Al guardar, la pantalla sube primero el archivo; si la RPC
rechaza, borra el archivo huérfano, y si reemplaza o quita el logo borra el anterior.

## Reversión

Migración aditiva. Revertir = `drop function public.actualizar_organizacion(text, text, text)`,
borrar las cuatro políticas `logos_organizacion_*` y el bucket (tras vaciarlo), y retirar las
columnas `zona_horaria` y `logo_path` en una migración **posterior** (no en el mismo PR que las
crea). Deshacer la spec completa: `git revert -m 1 <merge>`.

## Logo de la organización: límites conocidos (MSF-253)

- El selector de archivos es un `<input type="file">` visualmente oculto (no `hidden`); el botón «Subir/Cambiar logo» lo abre con `click()`, por lo que funciona con Enter/Espacio.
- El borrado del logo anterior o huérfano es de mejor esfuerzo: si falla se registra con `console.warn` y el archivo queda sin referencia en `logos-organizacion`. Hoy no hay limpieza automática del bucket (deuda conocida): los huérfanos se acumulan. Seguimiento: sin clave propia todavía; se registra bajo la épica MSF-132 como deuda «limpieza de huérfanos de `logos-organizacion` (job vía Kestra)» y al crearse su historia de operación se reemplaza esta línea por su clave.
- `actualizar_organizacion` valida el patrón de la ruta pero no que el objeto exista en `storage.objects`; la pantalla solo guarda rutas que ella misma subió.
- Sin control de concurrencia: gana el último que guarda (aceptado).
- La lista de zonas horarias usa `Intl.supportedValuesOf` con lista fija de respaldo; la base valida contra `pg_timezone_names`.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
