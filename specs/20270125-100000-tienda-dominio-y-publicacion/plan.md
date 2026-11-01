# Implementation Plan: Tiendas online · Tienda dominio y publicación

**Branch**: `epic/MSF-133-tiendas-online-tienda-dominio-y-publicac` | **Date**: 2026-11-01 | **Spec**: `specs/20270125-100000-tienda-dominio-y-publicacion/spec.md`

**Delivery scope**: `refine` + `supabase` (incluye una Edge Function). Sin `kestra`, `superset` ni `workers`.

## Resumen

El administrador conecta y verifica el dominio de su tienda (registros DNS calculados en el servidor, verificación por Edge Function, estado del certificado), prepara cambios en un **borrador** que la tienda pública no ve, los **publica** en una transacción que deja una **versión** numerada, y puede **restaurar** una versión anterior como borrador. Tres historias en serie sobre una pestaña común «Dominio y publicación»; cada una trae su propia migración aditiva.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Pestaña nueva `pestanas/publicacion.tsx` (clave `publicacion` en `pestanas.ts`) que compone secciones de `pestanas/publicacion/*.tsx` por `import.meta.glob` ordenadas por `orden` (`Dominio` F-TDA-05, `Publicacion` y `VistaPrevia` F-TDA-06, `Versiones` F-TDA-07), para que cada historia agregue archivos sin editar los de otra. Vista previa en `/empresas/:id/tienda/vista-previa`.
- **Base**: Postgres self-hosted; esquemas `dominio` (tablas), `public` (RPC authenticated y configuración de plataforma) y `publico` (solo funciones anónimas). RLS con `private.organizacion_id()` y `private.nivel_seccion('empresas')`.
- **Estado del código verificado**: existen `dominio.tiendas` y su trigger de auditoría, `dominio.tienda_identidad|contenido`, `categorias_tienda|productos_tienda`, las tres RPC `guardar_*`, `listar_catalogo_tienda`, `publico.*`, `private.registrar_actividad` y el front público/gestión de MSF-147/167/191. **No existen**: columnas de verificación, `tienda_registros_dns`, `tienda_dns_plataforma`, borrador, versiones, la Edge Function, `openapi/`.
- **Edge Function**: `supabase/functions/verificar-dominio-tienda` (handler testeable como las demás, p. ej. `solicitar-acceso`). Consulta DNS con la API de Deno y comprueba TLS solo después de que el A apunte a la plataforma. Escribe con un RPC exclusivo de `service_role`.
- **Testing**: pgTAP (`supabase/tests/database/`), Deno test de la función, Vitest + axe, Playwright E2E. `pnpm test` requiere `pnpm dev:supabase`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en las 4 tablas nuevas; sin escritura directa de `authenticated`; borrador y versiones sin privilegios para `anon`; service-role solo en la Edge Function. |
| II Especificar primero | Esta spec; todo FR/SC tiene una tarea dueña única. |
| III Idempotencia/auditoría | `publicar_tienda` y `descartar` idempotentes; eventos `tienda.dominio_verificado|publicada|borrador_descartado|version_restaurada`. |
| IV Despliegues independientes | Sin Compose nuevo; la función se despliega con Supabase. |
| V Simplicidad | Sin infraestructura nueva; la comprobación de certificado es un intento TLS (D1), sin integrar API del proveedor. |
| VI Panel operable | Ubicación, audiencia, rutas, patrones, a11y y carga diferida declarados en la spec. |
| VII Esquemas | `dominio.tiendas` (alter), `tienda_registros_dns`, `tienda_borrador`, `tienda_versiones` → `dominio`; `tienda_dns_plataforma` → `public` (config de plataforma); `publico` sin tablas. Re-verificado aquí: coincide con la spec. |
| VIII Empresa activa | FR-018, FR-065, FR-076 + fila «Empresa activa» en la matriz + SC-006. |
| Documentación | `docs/tiendas-online.md` y `docs/empresas.md` (cierre T026); `openapi/verificar-dominio-tienda.json` en el PR de la función. |

Regla «anon solo ejecuta las RPC de acceso»: se respeta. La única función nueva para `anon` está en `publico` (`redireccion_por_dominio`); todo lo demás es `authenticated` con `revoke … from public, anon`, o `service_role`.

## Estructura de migraciones (una por historia, aditivas)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-05 | `20270125100000_tienda_dominio_verificacion.sql` | Columnas en `dominio.tiendas`, `tienda_registros_dns`, `public.tienda_dns_plataforma`, `configurar_dominio_tienda`, `obtener_dominio_tienda`, `preparar_verificacion_tienda`, `registrar_verificacion_dns`, `private.promover_dominio_pendiente`, `publico.redireccion_por_dominio` | `drop` de funciones y tablas nuevas; `alter table dominio.tiendas drop column …` |
| F-TDA-06 | `20270125100100_tienda_borrador_publicacion.sql` | `tienda_borrador`, `tienda_versiones` (+ versión 1 de las tiendas existentes), validadores `private.validar_*`, RPC de borrador, `publicar_tienda`, `vista_previa_tienda`, revoke de las tres `guardar_*` | reponer `grant execute` de las `guardar_*`; `drop` de funciones y tablas |
| F-TDA-07 | `20270125100200_tienda_versiones.sql` | `listar_versiones_tienda`, `restaurar_version_tienda` (solo funciones) | `drop function` |

Independencia: ninguna migración referencia objetos de otra al crearse (las funciones PL/pgSQL resuelven `dominio.tienda_borrador|tienda_versiones` en ejecución); el orden entre historias lo fija el plan de ejecución. Timestamps posteriores a `20270121121300_busqueda_global_productos.sql` (última de la base).

## Contratos

Ver `contracts/tienda-dominio-publicacion.md` (RPC, función `publico`, Edge Function y la línea `BREAKING` de las tres `guardar_*`). El request/respuesta/errores de la Edge Function van en `openapi/verificar-dominio-tienda.json` (T006).

## Frontend

- **F-TDA-05**: `Dominio.tsx` (campos, avisos, tabla, «Verificar ahora»); la redirección del dominio secundario en el enrutador público consulta `publico.redireccion_por_dominio` si `tienda_por_dominio` no devuelve fila.
- **F-TDA-06**: `Publicacion.tsx`, diálogos Publicar/Descartar, cambios en las tres pestañas (cargar borrador, guardar en borrador) y vista previa. Las secciones de `tienda-publica/` aceptan una **fuente de datos inyectable** (por defecto la RPC `publico.*`; en la vista previa, `vista_previa_tienda`).
- **F-TDA-07**: `Versiones.tsx` y diálogo «Restaurar versión».
- Estados de carga/vacío/error/éxito del kit; teclado y lector de pantalla; 320/768/1440 px. Principio VIII: invalidar consultas y cerrar diálogos al cambiar de empresa.

## Verificación

- pgTAP por historia (aislamiento, `anon` sin borrador/versiones, publicación transaccional e idempotente, versión 1, revoke de `guardar_*`) y comprobación de que `publico` no tiene tablas.
- Deno test de la función con DNS/TLS simulados; Vitest + axe; E2E de cierre con dos empresas.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Proveedor del SSL sin confirmar (D1) | La comprobación TLS es una función aislada y reemplazable; la pantalla no cambia. |
| `Deno.resolveDns` / `Deno.connectTls` no disponibles en el runtime de Edge Functions self-hosted | Validarlo primero en T006; si no, mover la verificación a un worker en `workers/` con el mismo contrato (decisión a anotar en la tarea y el PR). |
| SSRF por comprobación TLS a hosts elegidos por el usuario | Solo se conecta si el A resuelto coincide con la IP de la plataforma; hostnames salen de la base, nunca del request. |
| Cambiar las `guardar_*` rompe llamadas existentes | `BREAKING` declarado; el front se migra en T014; pgTAP T016 comprueba el revoke. |
| Lectura pública del bucket expone archivos del borrador por URL | Rutas con UUID no adivinables; no hay listado público; el archivo no se enlaza desde `publico.*` hasta publicar. |
| La vista previa depende de secciones públicas de otras épicas | Fuente de datos inyectable; lo que no la soporte (catálogo, ficha) queda fuera y anotado. |
| Dos administradores editan el borrador a la vez | Gana el último guardado por área; publicar bloquea la empresa. |
| Horas (40 h) vs. alcance | Sin recorte previsto; D3, D4 y D6 son los candidatos si hubiera que reducir. |

## Documentación

- `docs/tiendas-online.md`: dominio y DNS por entorno, estados, borrador/versiones, operación y reversión.
- `docs/empresas.md`: enlace a «Dominio y publicación».
- `docs/roadmap-template.md`: fila de la épica al cerrar (paso manual del cierre).
