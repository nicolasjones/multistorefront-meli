---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - supabase/tests/database
  - apps/web/src
  - infra/kestra/flows
---

# Auditoría avanzada y soporte (MSF-170), construcción interna

**Épica:** MSF-170 · **Historias:** F-AUD-02 (MSF-259), F-AUD-03 (MSF-278) y F-OPS-04 (MSF-300).
**Spec:** `specs/20261102-100000-auditoria-avanzada-y-soporte/` (`spec.md`, `plan.md`, `contracts/auditoria-avanzada-y-soporte.md`).
**Producto:** [Consultar la actividad](../producto/actividad.md) · **Datos y DER:** [Auditoría avanzada y soporte](datos.md#auditoria-avanzada-y-soporte-msf-170).
Alcance de entrega: `refine`, `supabase` y `kestra`.

> **Fuente.** La implementación está integrada en `dokploy` (PR #762, rama de origen
> `epic/MSF-170-plataforma-auditoria-avanzada-y-soporte`) y todavía no en `main`: esta página describe `dokploy`.
> Los datos salen de sus migraciones, spec, pruebas y commits `2d322e7f` (F-AUD-02), `b456c01c` (F-OPS-04),
> `92831860` (F-AUD-03) y `e0f3de00` (cierre y revisión de seguridad). Verificar contra `main` cuando
> llegue la promoción de `dokploy`.

## Qué resuelve

| Historia | Entrega | Migración |
|---|---|---|
| F-AUD-02 | Catálogo de tipos sensibles, valor anterior/nuevo, registro inalterable, detalle por evento y depuración por retención. | `20270207100001_registro_inalterable_antes_despues.sql`, `20270207100002_depurar_registro_actividad.sql` |
| F-AUD-03 | Exportación del historial filtrado a CSV, con permiso propio y tope de 50.000 filas. | `20270210110000_exportar_actividad.sql` |
| F-OPS-04 | Ingreso de soporte con motivo, vencimiento a 4 horas y registro en la actividad del cliente. | `20270207100003_acceso_soporte_auditado.sql` |

## F-AUD-02 — Registro inalterable con antes y después

### Catálogo y valores

- `public.tipos_evento_actividad` (`20270207100001…`): `tipo` PK con formato `entidad.accion`, `sensible`
  booleano y `descripcion`. RLS con `select` para `authenticated`, sin `anon` y sin escritura desde la app.
  Un tipo ausente del catálogo se trata como **no sensible**.
- Sembrados como sensibles: `usuario.rol_cambiado`, `usuario.removido`, `usuario.suspendido`,
  `usuario.reactivado`, `permisos.matriz_guardada` y `permisos.matriz_restablecida`.
- `public.registro_actividad` gana `valor_anterior` y `valor_nuevo` (`jsonb`, nullable, objeto
  `{campo: valor}` de hasta 8 KB cada uno; check `registro_actividad_valores_check`).

### Escritura

- `private.insertar_cambio_actividad(org, actor, tipo, detalle, anterior, nuevo, empresa)` y
  `private.registrar_cambio_actividad(tipo, detalle, anterior, nuevo, empresa)` (esta última toma
  organización y actor de la sesión). No son ejecutables por `authenticated` ni por `anon`.
- Si el tipo es sensible, ambos valores son obligatorios (alta → anterior `{}`; baja → nuevo `{}`). Sin
  ellos, con un tipo que no sea objeto o con más de 8 KB: `22023` y la operación de origen se revierte.
- `private.insertar_actividad` y `private.registrar_actividad` conservan su firma pero **rechazan**
  `22023` los tipos sensibles: para esos hay que usar las funciones de cambio.
- El trigger de membresía y `guardar_matriz_permisos` / `restablecer_matriz_permisos` guardan el antes y
  el después. En la matriz se guarda solo lo que cambió (`{"Operador · stock": "edicion"}` →
  `{"Operador · stock": "lectura"}`); si no entra en 8 KB, el resto se resume en «… otros cambios»
  (`private.instantanea_matriz` / `private.diferencia_valores`).

### Inalterabilidad

- Triggers `registro_actividad_inalterable_fila` (`before update or delete`) y
  `registro_actividad_inalterable_truncate` (`before truncate`) rechazan con `42501`, y se revocó
  `update, delete, truncate` a `public`, `anon`, `authenticated` y `service_role`.
- Únicas excepciones: el borrado en cascada al eliminar la organización (la función solo lo permite si la
  organización ya no existe) y la depuración por retención (`20270207100002…`), que marca la transacción
  con `set_config('msf.depurando_actividad','on', true)` y limpia la marca al terminar o al fallar.

### Detalle

- `public.obtener_detalle_actividad(p_id uuid)` es `security invoker` (rige la RLS), devuelve `valor_anterior`,
  `valor_nuevo` y `sensible`; cero filas si el evento no es de la organización o no hay permiso. `anon`
  no ejecuta.
- UI: `apps/web/src/hooks/useDetalleActividad.ts` y `apps/web/src/components/actividad/DetalleActividadDialog.tsx`,
  abiertos desde el botón **Ver detalle** de `apps/web/src/pages/actividad/list.tsx`. Es solo lectura, sin
  «deshacer». Muestra «Este evento no tiene valores registrados.» cuando no hay valores y «Este evento ya no
  está disponible.» si la RPC devuelve cero filas. Si cambia la empresa activa, `list.tsx` cierra el
  diálogo y avisa (Principio VIII).

### Depuración por retención

- `private.depurar_registro_actividad(p_hasta timestamptz default now())` borra los eventos con más de
  24 meses, deja un evento `sistema.depurada` por organización con la cantidad y es idempotente. Solo la
  ejecutan `workers_orquestacion` y `kestra_orquestacion`.
- El flow `infra/kestra/flows/depuracion-actividad.yml` corre todos los días a las 04:00 y falla visible
  si la función falla; lo valida `infra/kestra/validar-depuracion-actividad.test.mjs`.

### Pruebas y reversión

- pgTAP `supabase/tests/database/registro_inalterable.test.sql` (catálogo, límites de 8 KB, sensibles sin
  valores, update/delete/truncate por rol, cascada, detalle, `anon`) y
  `depurar_registro_actividad.test.sql` (24 meses, rol no autorizado, evento «Sistema», idempotencia).
- Vitest `apps/web/src/components/actividad/DetalleActividadDialog.test.tsx` y
  `apps/web/src/pages/actividad/list.test.tsx`.
- Reversión en el encabezado de cada migración: quitar triggers y funciones, restaurar las versiones de
  `insertar_actividad`, `guardar_matriz_permisos`, `restablecer_matriz_permisos` y el trigger de membresía,
  y recién después quitar columnas y tabla (los valores se pierden).

## F-AUD-03 — Exportar la actividad

- RPC `public.exportar_actividad(p_desde, p_hasta, p_empresa, p_actor, p_tipo, p_texto, p_corte,
  p_cursor_creado_en, p_cursor_id, p_limite, p_entregadas, p_exportacion, p_con_total)`, `security definer`
  con `search_path = ''`. Nació en `20270210110000` con paginación por desplazamiento y la reemplazó
  `20270214300001` (fix de la revisión retroactiva de MSF-278), que **elimina** la firma de 9 parámetros. El
  spec pedía `security invoker`; se pasó a `definer` porque necesita registrar `actividad.exportada` y
  `authenticated` no escribe en `registro_actividad`. La lectura se acota explícitamente a
  `private.organizacion_id()`.
- Paginación por cursor `(creado_en, id)`: cada lote lee solo su página y usa los índices de
  `registro_actividad`. La primera llamada pide el total (`p_con_total`) y recibe el `corte`; las siguientes
  reenvían `corte` y el cursor `siguiente`. Devuelve `{ filas, total, tope, recortado, corte, hay_mas,
  siguiente }`. El cliente verifica que las filas bajadas coincidan con el total y, si no, lanza
  `ExportacionIncompletaError` (nunca entrega un archivo parcial).
- Permiso: nivel `edicion` en `actividad` **y** `private.puede_accion('actividad','exportar')`; en
  cualquier otro caso `42501`. `anon` y `public` no ejecutan. En la UI,
  `apps/web/src/components/actividad/BotonExportarActividad.tsx` solo renderiza el botón si se cumplen
  las dos condiciones (por defecto, solo el Administrador).
- Mismos filtros, zona horaria (`America/Argentina/Buenos_Aires`) y orden que `public.listar_actividad`,
  así que `total` coincide con el «N» del listado (SC-004). Se pide de a 1.000 filas con un `corte`
  estable que el cliente reenvía; el tope es de 50.000 filas y `total` trae el conteo real para avisar el
  recorte.
- CSV (`apps/web/src/lib/exportarActividad.ts` sobre `lib/exportarCsv.ts`): UTF-8 con BOM, separador `;`,
  CRLF, columnas **Cuándo, Tipo, Tienda, Detalle, Quién**, hora de Buenos Aires, celdas que empiezan con
  `= + - @` neutralizadas y nombre `actividad-AAAA-MM-DD.csv`. No lleva los valores antes/después. Las
  celdas con tabulación o retorno de carro también se neutralizan.
- Estados (`useExportarActividad.ts`): «Exportando…», error con **Reintentar** sin descargar un archivo
  parcial, «No hay actividad para exportar.» y aviso de recorte. Cambiar la empresa activa invalida la
  exportación en curso (nunca se baja un archivo de otra empresa).
- Constancia y conteo del lado servidor (migración `20270215600001`): `actividad.exportada` se registra en la
  **primera llamada** de cada exportación («Inició la exportación de N registros…», N = menor entre el total y el
  tope, con los filtros en palabras), de modo que paginar y abandonar, o un filtro que excede el tope, también
  dejan constancia. El cliente genera un id por corrida (`p_exportacion`); `private.exportaciones_actividad`
  (clave primaria `(organizacion_id, usuario_id, id)`, columnas `entregadas` y `cerrada`, RLS activa y sin
  acceso para los roles de la API) lleva el conteo y aplica el tope de 50.000. `p_entregadas` se ignora (queda en
  la firma por compatibilidad). El id se cierra al entregar la última fila o llegar al tope; reutilizar un id
  cerrado, también el reintento de la última página, lanza `22023` (el comentario de `20270214300001`, que dice
  que un reintento «no vuelve a registrar», es inexacto). Un cliente que use un id nuevo por página deja una
  constancia por página. La depuración purga las filas de `exportaciones_actividad` con más de 30 días.
- Pruebas: pgTAP `exportar_actividad.test.sql`; Vitest `exportarActividadCsv.test.ts`,
  `exportarActividad.test.tsx` y `BotonExportarActividad.test.tsx`; E2E
  `apps/web/e2e/actividad-exportar.e2e.ts`.
- Reversión (migración posterior; las migraciones aplicadas no se editan): para volver al contrato
  anterior hay que eliminar la firma de 13 parámetros, `drop function
  public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer,
  integer, uuid, boolean);`, y `drop table private.exportaciones_actividad;`; y recién entonces recrear la
  de `20270210110000`. El tipo `actividad.exportada` se borra de `tipos_evento_actividad`.

## F-OPS-04 — Acceso de soporte auditado

- Migración `20270207100003…`: `superadmin_entradas.motivo` (no vacío y ≤ 500) y
  `superadmin_organizacion_activa.vence_en` (default `now() + interval '4 hours'`, backfill de los
  contextos existentes). La vista `private.superadmin_contexto_vigente` (`security_invoker`) excluye los
  vencidos; la migración reescribe **todos** los helpers que leían la tabla (`organizacion_id`,
  `puede_escribir`, `nivel_seccion`, `puede_accion*`, `rol_id`, los `puede_*_en_empresa`, etc.) para que
  lean la vista. `entrar_a_organizacion`, `salir_de_organizacion` y `cerrar_accesos_soporte_vencidos` (`20270215600002`, la
  ejecuta Kestra cada 15 minutos) leen la tabla para distinguir salida de vencimiento.
- Contrato **BREAKING**: `public.entrar_a_organizacion(org_id uuid, p_motivo text)` reemplaza a la versión
  de un argumento; sin motivo (o en blanco o > 500) devuelve `22023`, sin ser superadmin `42501`, y si la
  organización no existe `P0002`. `public.salir_de_organizacion()` conserva la firma.
- Cada ingreso, salida y vencimiento queda en `superadmin_entradas` (`accion` `entrada` / `salida`, con
  `motivo` en la entrada) y como evento `soporte.ingreso`, `soporte.salida` o `soporte.vencido` en el
  historial de la organización visitada, con la persona de soporte como actor. Todo en la misma
  transacción.
- UI: `apps/web/src/components/DialogoMotivoSoporte.tsx` (motivo obligatorio, Cancelar/Ingresar, errores
  del servidor), `apps/web/src/pages/organizaciones/list.tsx` (abre el diálogo desde **Ingresar**) y
  `apps/web/src/components/OrganizacionActivaBanner.tsx` (banner «Acceso de soporte hasta HH:MM» en hora
  de Buenos Aires, **Salir**, limpieza y aviso al vencer). `apps/web/src/lib/superadmin.ts` lee `vence_en`
  y descarta los accesos vencidos.
- El Administrador del cliente ve los eventos `soporte.*` por la RLS y la matriz existentes; otra
  organización no los ve.
- Endurecimiento del cierre: `entrar_a_organizacion` y `salir_de_organizacion` usan `set search_path = ''`
  con nombres calificados (commit `e0f3de00`, revisión `authz-security`).
- Pruebas: pgTAP `acceso_soporte_vigencia.test.sql` y `acceso_soporte_actividad.test.sql`; Vitest
  `apps/web/src/components/AccesoSoporte.test.tsx`.
- Reversión: restaurar los helpers a la tabla, recrear `entrar_a_organizacion(uuid)` de
  `20260908221453_contexto_organizacion_activa.sql`, `drop` de la vista y de las columnas `vence_en` /
  `motivo`. Los eventos ya escritos se conservan.

## Permisos

| Quién | Puede ver Actividad | Puede exportar | Acceso de soporte |
|---|---|---|---|
| Administrador | Sí (`edicion`) | Sí, con la acción `exportar` | Ve `soporte.*` de su organización |
| Operador y Administración | Sí (`lectura`) | No | Ven `soporte.*` si la matriz les da lectura de Actividad |
| Consulta, Mostrador, Depósito, Miembro | No | No | No |
| Superadmin | Solo con organización activa | Sí: en modo soporte `nivel_seccion` resuelve `edicion` y `puede_accion` resuelve `true` sin consultar la matriz de esa organización (lo prueba el pgTAP) | Entra con motivo y vence a las 4 h |

La matriz manda para los roles de la organización: si cambia el nivel o la acción, la pantalla y la RLS
siguen sin tocar código. Exportar exige las dos cosas a la vez (nivel `edicion` y acción `exportar`): un
Operador con la acción pero con nivel `lectura` recibe `42501`. La spec (FR-010/FR-011) decía que por
defecto exportaban Administrador, Operador y Administración; el código es más estricto a propósito (solo el
Administrador, de hecho) y la spec no se actualizó.

## Operación y despliegue

- Orden de migraciones: `…100001` (F-AUD-02), `…100002` (depuración), `…100003` (F-OPS-04) y
  `20270210110000` (exportación) y `20270214300001` (exportación por cursor y constancia idempotente; elimina la
  firma anterior de `exportar_actividad`). Todas son aditivas salvo el reemplazo declarado de
  `entrar_a_organizacion` y de la firma de `exportar_actividad`; la reversión está en el encabezado de cada
  una.
- La reescritura de los helpers de organización activa toca todas las RLS: desplegar primero en staging y
  correr `aislamiento_organizaciones` (riesgo anotado en `plan.md`).
- Kestra: flow `depuracion-actividad` con el rol `kestra_orquestacion`; no agrega variables de entorno
  nuevas (usa `envs.kestra_orquestacion_db_url` y `envs.kestra_orquestacion_db_password`).
- Verificación de despliegue: `pnpm test:db`, `pnpm test`, `pnpm infra:config`, `pnpm build`.

## Guía de prueba

**Prerrequisitos:** entorno DEV o local (`pnpm dev:supabase`); una organización con al menos dos empresas;
un Administrador con `edicion` en Actividad y la acción `exportar`; un Operador (solo lectura) y un rol sin
acceso a Actividad; un superadmin de plataforma; una segunda organización. Para el evento sensible, cambiar
el rol de una persona. Para la retención, filas de `registro_actividad` con `creado_en` de más de 24 meses
solo en base local/staging.

**Pasos (UI):**
1. Como Administrador, ir a **Administración → Actividad** y tocar **Ver detalle** en un cambio de rol → se
   ve Cuándo, Tipo, Tienda, Quién, Detalle y la tabla **Campo / Antes / Después** con el rol anterior y el nuevo.
2. Abrir un evento viejo o uno no sensible → «Este evento no tiene valores registrados.».
3. Con un detalle abierto, cambiar la empresa activa en la barra superior → el detalle se cierra con el aviso
   «Cambiaste de empresa: cerramos el detalle que estabas viendo.».
4. Elegir período, tienda, usuario y tipo, escribir en la búsqueda y tocar **Exportar** → se descarga un CSV
   con todas las filas del filtro (no solo la página), columnas Cuándo, Tipo, Tienda, Detalle y Quién.
5. Comparar el total del listado con la cantidad de filas del archivo (hasta 50.000) → coinciden.
6. Repetir con el Operador → no aparece **Exportar** y la llamada directa a `exportar_actividad` devuelve `42501`.
7. Aplicar un filtro sin resultados y tocar **Exportar** → «No hay actividad para exportar.» y no se descarga archivo.
8. Como superadmin, ir a **Organizaciones → Ingresar** → el diálogo pide **Motivo del acceso**; sin motivo
   **Ingresar** está deshabilitado; con motivo, el banner muestra «Acceso de soporte hasta HH:MM».
9. Como Administrador de la organización visitada, abrir Actividad → aparecen `soporte.ingreso` (con motivo y
   vencimiento) y, al salir, `soporte.salida`; el Administrador de otra organización no los ve.
10. Llevar `vence_en` al pasado en local (`update public.superadmin_organizacion_activa set vence_en = now() - interval '1 minute'`)
    → el superadmin ve 0 filas de la organización y la app lo manda a Organizaciones con aviso.

**Pasos (SQL/pgTAP):** `registro_inalterable.test.sql`, `depurar_registro_actividad.test.sql`,
`acceso_soporte_vigencia.test.sql`, `acceso_soporte_actividad.test.sql` y `exportar_actividad.test.sql` con
`pnpm test:db`.

**Resultado esperado:**
- **Given** un evento sensible registrado, **When** se abre su detalle, **Then** se ve el valor anterior y el
  nuevo campo por campo y no hay acción de deshacer.
- **Given** cualquier fila de `registro_actividad`, **When** se intenta `update`, `delete` o `truncate`,
  **Then** falla con `42501` (salvo cascada de organización y depuración autorizada).
- **Given** filtros activos, **When** se exporta, **Then** el CSV trae todo el filtro hasta el tope de 50.000
  filas y sin permiso la RPC devuelve `42501`.
- **Given** un superadmin, **When** ingresa sin motivo, **Then** se rechaza; con motivo, **Then** queda
  registrado para el cliente y vence solo.

**Cómo automatizarlo:**
- pgTAP: `[MSF-170:T008]` (inalterabilidad y antes/después), `[MSF-170:T010]` (depuración),
  `[MSF-170:T018]`/`[MSF-170:T019]` (soporte), `[MSF-170:T026]` (exportación).
- Vitest: `[MSF-170:T012]` (`DetalleActividadDialog`), `[MSF-170:T020]` (`AccesoSoporte`) y
  `[MSF-170:T023]`/`[MSF-170:T026]` (botón y CSV de exportación).
- Kestra: `[MSF-170:T011]` (`validar-depuracion-actividad.test.mjs`, `pnpm infra:config`).
- E2E: `apps/web/e2e/actividad-exportar.e2e.ts` cubre la exportación (CA-AUD-03-1, 3 y 4).
- **Pendiente de automatizar:** no hay E2E del detalle del evento ni del acceso de soporte; esos recorridos
  se cubrirían con un E2E nuevo (propuesta de rótulo `[MSF-170:T029]`, cierre) sobre la suite Playwright
  (`docs/e2e-app.md`).

## Pendientes

- TODO (dueño: Documentación/QA): capturas del manual para el detalle, la exportación, el diálogo de motivo y
  el banner en `docs/producto/img/actividad/` con `pnpm docs:capturas`; no se pudieron generar porque el
  código de la épica no está en esta rama y el comando no existe todavía en `package.json`.
- TODO (dueño: QA): automatizar el E2E del detalle de Actividad y del acceso de soporte; hoy quedan cubiertos
  por pgTAP y Vitest (la exportación ya tiene su E2E).
- TODO (dueño: Producto): confirmar con el cliente la retención de 24 meses, el plazo de 4 horas del acceso
  de soporte y la lista de eventos sensibles (hoy usuarios y permisos).
- TODO (dueño: Ingeniería): al fusionar la épica en `main`, verificar las rutas citadas, regenerar el
  inventario y el manifest de `docs/` y quitar la nota de «rama sin fusionar».

## Limitaciones conocidas (revisión independiente de la épica)

Los hallazgos de la revisión independiente se corrigieron en las migraciones `20270215600000`, `20270215600001`
y `20270215600002` (PR a `dokploy`): constancia y tope del lado servidor, triggers de `registro_actividad`
y `superadmin_entradas` en `ENABLE ALWAYS` (esta última append-only), cierre automático de accesos de soporte
vencidos (flow de Kestra `cierre-accesos-soporte`, cada 15 minutos), purga a 30 días de
`exportaciones_actividad` y guardia de CI `acceso_soporte_sin_lecturas_crudas` contra lecturas crudas de
`superadmin_organizacion_activa`. Siguen abiertas:

- **Reingreso sin tope acumulado (decisión de negocio pendiente).** Reingresar a la misma organización con el
  acceso vigente renueva el vencimiento a 4 h desde ese momento, sin límite acumulado (cada vez pide motivo y
  queda `soporte.ingreso`). No se inventó un tope: falta que Nicolás defina el máximo de renovaciones u horas
  seguidas.
- **Borrado en cascada de la cuenta de soporte.** Eliminar la cuenta de una persona de soporte borra sus filas de
  `superadmin_entradas` (la FK es `on delete cascade`; el trigger append-only lo permite para no impedir bajas
  de superadmins, igual que el borrado de la organización).
- **E2E pendientes.** Faltan los E2E del detalle de Actividad y del acceso de soporte (diálogo de motivo,
  banner, vencimiento): necesitan Supabase y no se pudieron ejecutar al corregir, así que no se agregaron a ciegas.
