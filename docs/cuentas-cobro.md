---
owner: producto
sources: [apps/web/src, specs]
---
# Cuentas de cobro (F-VTA-03 · MSF-240)

Cuentas bancarias y billeteras de la **organización** donde se cobran las ventas por transferencia o
depósito. Cada cuenta se habilita por empresa («Disponible en»). Spec:
`specs/20261020-100000-ventas-catalogos-de-cobro-y-envio/` (FR-010…FR-015, SC-005, SC-006). El cierre de la
épica MSF-139 integra esto en `docs/ventas-catalogos.md`.

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Naturaleza | Notas |
|---|---|---|
| `dominio.cuentas_cobro` | Dato de negocio y sensible del producto → `dominio` | Nombre, titular, CUIT, banco, alias, CBU/CVU, tipo, moneda, orden, `activa`, notas, `updated_at`. |
| `dominio.cuentas_cobro_empresas` | Relación del negocio («Disponible en») → `dominio` | PK `(cuenta_id, empresa_id)`; un disparador exige cuenta y empresa de la misma organización. |

- **No se borra nada**: sin política ni grant `DELETE`. «No usar» es `activa = false`: no se ofrece al cargar un
  comprobante pero conserva su historial; reactivar la vuelve a ofrecer.
- Una cuenta sin empresas marcadas se permite y queda «sin disponibilidad».
- Migraciones aditivas `20261020120000` (tablas y RLS), `…120100` (validación), `…120200` (RPC) y `…120300`
  (actividad). Cada una trae su reversión en el encabezado.

## Permisos

- **Lectura**: nivel `ventas` ≥ lectura en la organización (política `select` y `listar_cuentas_cobro`).
- **Escritura**: solo **Administrador** (`private.es_administrador_de`), en la política RLS y de forma explícita
  (`42501`) en cada RPC. Un rol con edición en Ventas que no es Administrador **lee pero no escribe**.
- `anon` sin privilegios sobre las tablas ni las RPC. La habilitación por empresa no tiene grants de escritura:
  solo la escribe `private.guardar_empresas_cuenta_cobro` (security definer, revalida Administrador y organización).

## Validación (la base es la autoridad)

- **CUIT** del titular: `private.cuit_valido` (módulo 11), con o sin guiones; se guarda con 11 dígitos.
- **CBU/CVU**: `private.cbu_valido`: 22 dígitos; el primer bloque (8) con pesos 7-1-3-9-7-1-3 y el segundo (14)
  con 3-9-7-1-3-9-7-1-3-9-7-1-3; verificador de cada bloque `(10 − suma mod 10) mod 10`. Se guarda sin espacios.
- El cliente repite las mismas reglas (`apps/web/src/lib/ventas/cbu.ts`, `lib/cuit.ts`) con los mismos vectores
  que el pgTAP (`0170099220000067797370` y `2850590940090418135201` válidos). Son vectores sintéticos públicos, no cuentas reales: `.gitleaks.toml` exime solo esos dos valores exactos (regex), no el archivo
  (los tests ya están exentos por path) para que gitleaks no los reporte como secretos.
- `orden` es un entero de 0 a 2147483647 (tope de `integer`); el formulario lo valida en el campo.
- En la base, CUIT y CBU son opcionales (la carga inicial, MSF-142, puede no traerlos) pero **si vienen se validan**;
  las RPC y el formulario los exigen.

## RPC (`public`, `security invoker`, `grant … to authenticated`, `revoke … from public, anon`)

- `crear_cuenta_cobro(...)`, `actualizar_cuenta_cobro(p_id, p_actualizado_en, ...)` (bloqueo optimista: `40001`
  si otra persona modificó la cuenta; un cambio solo de empresas también avanza `updated_at`) y
  `cambiar_estado_cuenta_cobro(p_id, p_activa)` (idempotente).
- `listar_cuentas_cobro(p_empresa_id, p_estado, p_pagina, p_tamano)`: pagina y filtra en el servidor
  (`p_estado`: `todas | activas | no_usar`).

## Actividad

`cuenta_cobro.creada|editada|desactivada|reactivada` en `registro_actividad`, en la misma transacción, con el
nombre de la cuenta; **nunca el CBU ni el CUIT**. Sin evento si no hubo cambio real. Ver `docs/actividad.md`.

## Pantalla

`/ventas/cuentas-cobro` (menú **Ventas › Cuentas de cobro**, sección `ventas`; «Acceso restringido» sin permiso).
Fuente visual: `design/pantallas/CuentasCobro.dc.html`. Filtro `Tienda` (sigue a la empresa activa de la barra
superior), filtro de estado `Todas | Activas | No usar`, recuento y paginación «1–10 de N», tarjetas en angosto.
Solo el Administrador ve `Nueva cuenta de cobro`, `Editar` y `Marcar No usar`/`Reactivar`.

Decisiones de implementación: `Banco` es texto libre (el prototipo muestra un selector, pero no hay catálogo de
bancos en la spec); `Tipo de cuenta` y `Moneda` son selectores segmentados como en el prototipo.

## Pruebas

pgTAP `supabase/tests/database/cuentas_cobro.test.sql`; Vitest `lib/ventas/cbu.test.ts`,
`lib/ventas/cuentasCobro.test.ts`, `components/ventas/CuentaCobroDialog.test.tsx` y
`pages/ventas/cuentas-cobro/list.test.tsx`.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
