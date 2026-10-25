---
owner: producto
sources: [apps/web/src, specs]
---
# Ventas · Catálogos de cobro y envío (épica MSF-139)

Guía de la épica: formas de pago y de envío por empresa, cuentas de cobro y transportes de la organización.
Spec: `specs/20261020-100000-ventas-catalogos-de-cobro-y-envio/` (FR-001…FR-020, SC-001…SC-010).
Detalle por historia: [cuentas-cobro.md](cuentas-cobro.md) (F-VTA-03) y [ventas-transportes.md](ventas-transportes.md) (F-VTA-04).

## Modelo (Principio VII: todas en `dominio`)

Son entidades de negocio del producto, no mecanismos de plataforma; ninguna vive en `public`. El pgTAP
`rls_en_toda_tabla` recorre `public` + `dominio` y falla si alguna queda sin RLS.

| Tabla | Alcance | Historia | Migraciones |
|---|---|---|---|
| `dominio.formas_pago` | por empresa | F-VTA-01 (MSF-210) | `20261020100000`, `…100100` |
| `dominio.formas_envio` | por empresa | F-VTA-02 (MSF-225) | `20261020110000`, `…110100` |
| `dominio.cuentas_cobro` + `dominio.cuentas_cobro_empresas` | organización, habilitada por empresa | F-VTA-03 (MSF-240) | `20261020120000` … `…120300` |
| `dominio.transportes` + `dominio.transportes_empresas` | organización, usada por empresa | F-VTA-04 (MSF-251) | `20261020130000`, `…130100` |

Reglas comunes: la organización sale de la sesión (sin grant de columna), nombre único (por empresa o por
organización según el catálogo), `updated_at` para bloqueo optimista (`40001`), **sin DELETE** (se desactiva).

## Permisos

- **Lectura**: sección `ventas` en `lectura` o `edicion` (`private.nivel_seccion('ventas')`); los catálogos por empresa
  además exigen `empresa_id` en `private.empresas_accesibles()`.
- **Escritura**: solo el Administrador (`private.es_administrador_de`), en la política RLS y dentro de cada RPC
  (`42501`). Un rol con edición en Ventas que no es Administrador lee pero no escribe.
- `anon`: sin privilegios sobre tablas ni RPC. Las RPC (`public`, `security invoker`, `search_path = ''`) llevan
  `revoke … from public, anon` y `grant execute … to authenticated`.
- Matriz completa en [permisos-por-rol.md](permisos-por-rol.md).

## Datos bancarios (CBU/CVU y CUIT)

- La base valida (`private.cbu_valido`, `private.cuit_valido`) y normaliza; el formulario repite las reglas con los mismos vectores.
- **Nunca** aparecen en `registro_actividad` (solo el nombre de la cuenta), ni en mensajes de error al usuario, ni en la consola
  del navegador (`mensajeDeError` de `lib/ventas/cuentasCobro.ts` loguea solo el código, porque el `details` de un check
  fallido trae la fila completa).
- Ningún acceso con service-role desde el navegador.

## Pantallas y rutas (grupo **Ventas** del menú, sección `ventas`)

| Ruta | Pantalla | Fuente visual |
|---|---|---|
| `/ventas/configuracion` | Configuración de ventas: pestañas `Formas de pago` y `Formas de envío` | `VentasConfiguracion.dc.html` |
| `/ventas/cuentas-cobro` | Cuentas de cobro | `CuentasCobro.dc.html` |
| `/ventas/transportes` | Transportes y terminales de retiro | `VentasTransportes.dc.html` |

Sin permiso se muestra «Acceso restringido» (`RequiereAccesoSeccion`). Fuera de alcance: pestañas RMA, Contrarreembolsos y Estados,
tableros de contrarreembolsos y motos, «Envíos del mes», Exportar, transporte preferido del cliente (MSF-180) y la carga de datos
reales (MSF-142); ver la matriz pantalla↔criterios de la spec.

## Reversión

Todas las migraciones son aditivas y traen su reversión en el encabezado (drop de funciones, disparadores y tablas en una migración
posterior). Descartar una tabla borra los datos cargados: exportar antes. Cada historia se revierte con `git revert -m 1` de su merge.

## Revisión de seguridad de cierre (T034 · SC-009)

Revisión `authz-security` del diff de la épica, con lectura de las diez migraciones y de los pgTAP `formas_pago`, `formas_envio`,
`cuentas_cobro` y `transportes`:

- **Esquema:** las seis tablas están en `dominio`, como declara la spec.
- **RLS:** las seis tienen `enable row level security`, política `select` por organización/`ventas` y escritura solo Administrador; sin política ni grant `DELETE`
  salvo `transportes_empresas` (relación N:M que la RPC reemplaza, solo Administrador).
- **`anon`:** `revoke all … from public, anon, authenticated` en cada tabla y `revoke … from public, anon` en cada RPC pública.
- **Funciones `security definer`:** todas con `search_path = ''`; los disparadores sin `grant` a nadie y
  `private.guardar_empresas_cuenta_cobro` revalida Administrador y organización en el cuerpo.
- **CBU:** hallazgo corregido en este cierre: `mensajeDeError` de cuentas de cobro enviaba el error crudo a `console.error`
  (un `23514` incluye «Failing row contains …» con el CBU). Ahora solo se loguea el código; test en `cuentasCobro.test.ts`.
- **Service-role en el navegador:** sin referencias en `apps/web/src` (solo un comentario que lo prohíbe).

Los pgTAP corren con `pnpm test` contra `pnpm dev:supabase`.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
