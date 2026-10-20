# Service técnico

Épica MSF-182 · spec en `specs/20261020-100000-service-alta-estados-y-permisos/`. Este documento crece con cada
historia; hoy cubre **F-SVC-01 · Modelos de equipo y estados de reparación configurables** (MSF-254).

## Modelo de datos (F-SVC-01)

Esquema (Constitución, Principio VII): las dos tablas son entidades de negocio del producto → **`dominio`**.
Ambas son **por organización** (no por empresa), con RLS, sin `delete` y sin acceso de `anon`.

| Tabla | Columnas | Reglas |
|-------|----------|--------|
| `dominio.modelos_equipo` | `id`, `organizacion_id` (de la sesión), `equipo`, `modelo`, `mano_obra_base` (ARS, sin IVA, `numeric(12,2)` ≥ 0), `activo`, `creado_en`, `updated_at` | Equipo + modelo únicos por organización sin distinguir mayúsculas ni tildes (incluye inactivos): índice `modelos_equipo_org_equipo_modelo_key`. `unique (id, organizacion_id)` para la FK compuesta de F-SVC-02. |
| `dominio.estados_reparacion` | `id`, `organizacion_id`, `nombre`, `descripcion` («Qué significa»), `orden`, `avisa_cliente`, `cierra`, `tono`, `activo`, `creado_en`, `updated_at` | Nombre único por organización sin distinguir mayúsculas ni tildes: índice `estados_reparacion_org_nombre_key`. `orden` no es único a propósito (permite el intercambio atómico). `orden` es **orientativo**: el `grant insert` lo incluye porque `crear_estado_reparacion` es `security invoker`, así que un insert directo por la API puede duplicarlo sin pasar por el bloqueo de la RPC; `mover` desempata por `id` y el orden mostrado sigue siendo estable. `cierra` y `tono` los fija el sembrado: la API no los escribe. |

`private.clave_texto(text)` (minúsculas, sin espacios de los bordes, sin tildes) arma la clave de comparación; no hay
`unaccent` en el stack.

**RLS**: `organizacion_id = private.organizacion_id()` y nivel de la sección `service_tecnico`
(`private.nivel_seccion`): `select` con `lectura` o `edicion`; `insert`/`update` con `edicion`. Un disparador
`before insert or update` recorta los textos y hace avanzar `updated_at` solo ante un cambio real (bloqueo optimista).

## Sembrado

`private.sembrar_service(organizacion)` (idempotente) crea los **siete modelos** y los **siete estados** del
prototipo (`design/pantallas/ServicioModelos.dc.html`, `ServicioEstados.dc.html`). Corre por disparador al crear una
organización y por relleno de las existentes. No pisa lo que la organización ya editó.

- Modelos: Nintendo Switch Estándar / Lite / OLED, Joystick Pro Controller / Joy-Con (par), PlayStation 4 Slim
  (**inactivo**, como en el prototipo) y PlayStation 5 Estándar.
- Estados (en orden): Recibido, En diagnóstico, Esperando repuesto, En reparación, Listo para entregar, Entregado,
  Sin reparación. Cierran: Entregado y Sin reparación. Avisan al cliente: Recibido, Esperando repuesto, Listo para
  entregar y Sin reparación.
- El **octavo estado** que menciona la épica se define con el cliente y se agrega desde la pantalla, sin migración.

## RPC (todas `security invoker`; exigen `edicion`; `revoke … from public, anon`, `grant execute … to authenticated`)

| RPC | Qué hace |
|-----|----------|
| `crear_modelo_equipo(equipo, modelo, mano_obra_base)` | Alta. Duplicado → `23505`. |
| `actualizar_modelo_equipo(id, actualizado_en, equipo, modelo, mano_obra_base)` | Edición con bloqueo optimista (`40001` si cambió). |
| `cambiar_estado_modelo_equipo(id, activo)` | Activa/desactiva; idempotente. |
| `crear_estado_reparacion(nombre, descripcion, avisa_cliente)` | Alta al final del orden (serializada por organización). |
| `actualizar_estado_reparacion(id, actualizado_en, nombre, descripcion, avisa_cliente)` | Edición con bloqueo optimista. |
| `mover_estado_reparacion(id, 'subir' \| 'bajar')` | Intercambia `orden` con el vecino en una sola sentencia; en un extremo no hace nada. |
| `cambiar_estado_estado_reparacion(id, activo)` | Activa/desactiva; idempotente. |

`avisa_cliente` y `cierra` **solo se guardan y se muestran**: esta épica no envía ningún aviso al cliente (FR-006).

## Actividad

Disparadores `security definer` en la misma transacción: `modelo.creado|editado|desactivado|reactivado` y
`estado.creado|editado|desactivado|reactivado|reordenado`, con el nombre visible (nunca ids). Sin evento si no hubo
cambio real; sin sesión (sembrado) no se registra. Ver `docs/actividad.md`.

## Pantallas y menú

- Menú **Service → Service técnico** (icono herramienta), visible por nivel de `service_tecnico` **y** por la
  funcionalidad `service-tecnico` de la organización (`private.tiene_feature`, vía `useFeatureHabilitada`). Entra a
  `/service-tecnico/modelos`; `/service-tecnico` redirige ahí.
- Rutas `/service-tecnico/modelos` y `/service-tecnico/estados`, protegidas por `RequiereServiceTecnico`
  («Acceso restringido» sin nivel o sin funcionalidad). Recursos `service-tecnico-modelos` y `service-tecnico-estados`
  en `SECCION_POR_RECURSO` y `RECURSOS_CONDICIONADOS_A_FEATURE`.
- **Registrar la funcionalidad no la habilita**: un superadmin la activa por organización desde *Funcionalidades*.
  La migración `20261020100700_service_funcionalidad.sql` (y `supabase/seed.sql` en un reset desde cero) la registra.
  **Runbook de despliegue**: si la base no tenía ningún superadmin al migrar, la migración solo avisa (`raise notice`) y
  no registra nada; tras el primer alta de superadmin hay que registrar `service-tecnico` en *Funcionalidades*
  (o `select public.registrar_feature(...)` como superadmin) y verificar con
  `select 1 from public.features where id = 'service-tecnico'` — si no devuelve fila, el menú no aparece.
- La pestaña **Reparaciones** se ve pero está deshabilitada hasta que F-SVC-02 entregue su pantalla
  (`REPARACIONES_DISPONIBLES` en `components/service/PestanasService.tsx`).
- Diferencias con el prototipo (decisiones confirmadas de la spec): sin «Disponible en» (los modelos son de la
  organización), sin columna *Reparaciones* (llega con F-SVC-02) y sin editar un modelo desde la pantalla (el
  prototipo solo dibuja el alta; la RPC de edición existe).

## Reversión

Todas las migraciones son aditivas y llevan su reversión en el encabezado (orden inverso: actividad → RPC →
sembrado → tablas → función `private.clave_texto`). Exportar antes los datos; no se destruyen columnas ni tablas en
el mismo PR que las crea.

## Pruebas

- pgTAP `supabase/tests/database/service_catalogos.test.sql` (SC-001); `rls_en_toda_tabla` recorre `public` + `dominio`.
- Vitest: `lib/serviceTecnico.test.ts`, `pages/service-tecnico/*.test.tsx`, `components/service/*.test.tsx`,
  `components/navegacion/SiderPanel.test.tsx` (SC-002).

## Secretos (gitleaks)

`pnpm calidad` marca gitleaks como «saltado» en máquinas sin el binario ni Docker (el paquete npm homónimo es un
placeholder). En CI (job `quality`, gitleaks nativo v8.30.1) el escaneo de este PR dio `no leaks found`; este cambio
no agrega secretos ni claves (solo migraciones, UI y docs).
