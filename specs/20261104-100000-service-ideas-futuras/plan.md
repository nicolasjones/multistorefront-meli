# Plan de implementación: Service técnico · Service ideas futuras (MSF-118)

**Spec**: [spec.md](spec.md) · **Contratos**: [contracts/service-ideas-futuras.md](contracts/service-ideas-futuras.md) · **Rama de la spec**: `epic/MSF-118-service-tecnico-service-ideas-futuras` (PR a `dokploy`, reemplaza al PR #680 cerrado) · **Ramas de implementación**: una por historia, `feat/MSF-190-etiqueta-qr`, `feat/MSF-181-aviso-whatsapp`, `feat/MSF-187-comisiones-tecnicos` (cada una con su PR a `dokploy`)
**Alcance de entrega**: `refine` (`apps/web`) y `supabase` (migraciones, RPC, pgTAP). Sin `kestra`, `superset` ni `workers` (D-1, D-11, D-20). Destino de despliegue: **solo dev** (D-26): Refine por el despliegue de dev del repo (`infra/refine/compose.yaml`) y Supabase self-hosted por el cron de migraciones de dev; nada toca staging ni producción.
**Estado (2026-11-17)**: spec cerrada y verificada contra `origin/dokploy` (`845620a5`); ninguna historia implementada. La épica está en `Backlog` (el hito lo define el cliente): la spec deja las tres historias listas para arrancar, no abre desarrollo por sí sola.

## Enfoque

Todo es **aditivo** sobre lo ya entregado de Service y sin superficie pública: ninguna ruta ni función es accesible sin sesión de panel.

1. **F-SVC-32 (QR)** es solo front: un generador de QR puro (`lib/qr/`), una vista imprimible (`pages/service-tecnico/etiqueta.tsx`) y un botón. No toca la base ni agrega dependencias. El riesgo está en la **corrección del generador**, que se acota con vectores dorados, una prueba de ida y vuelta y un escaneo real (FR-041); si no cierra, se usa el fallback de D-18.
2. **F-SVC-30 (WhatsApp)** reutiliza `lib/whatsapp.ts` (`normalizarNumero`, `urlWhatsapp`) y la tabla `reparacion_avisos` de MSF-232 con un canal nuevo. Una RPC de lectura mínima trae los datos del mensaje (para que el Técnico no necesite acceso a Clientes) y una de escritura idempotente deja el registro. **Nada se envía desde el servidor.**
3. **F-SVC-31 (Comisiones)** es la pieza grande: una tabla nueva de reglas append-only con vigencia, una función `private` de cálculo que es **el único punto de verdad** (el resumen y el detalle salen de ella), cuatro RPC y la pestaña con tres pantallas (informe, detalle, reglas).

Decisiones de diseño (las de producto están en `spec.md › Decisiones`):

1. **Un solo cálculo.** `private.comisiones_calculadas` devuelve una fila por reparación; `comisiones_resumen` agrega y `comisiones_detalle` pagina **la misma función**. El invariante «resumen = Σ detalle» lo prueba pgTAP con casos de varios ítems y varios comprobantes.
2. **Agregar antes de unir.** Los ítems se suman por reparación en una subconsulta; los comprobantes entran con `exists`. Así ni los ítems ni los comprobantes duplican filas (amenaza 2.7).
3. **Vigencia por fecha de entrega.** `private.regla_comision` resuelve la regla con la `entrega_real` (inmutable), de modo que ningún cambio de reglas toca lo ya calculado.
4. **Abrir primero, registrar después.** El `window.open` va dentro del gesto del clic (si no, los navegadores lo bloquean); el registro es después y con `clave` idempotente.
5. **La URL del QR se arma en un solo lugar** (`urlEtiquetaReparacion`) con una lista blanca de forma, para que ninguna otra cosa llegue al código.
6. **Carga infinita y empresa activa** en los listados nuevos (detalle de comisiones), reutilizando `CargaInfinita`, `useListadoAcumulado`, `FiltroEmpresa`, `EtiquetaEstado` y los patrones de estado.

## Estado verificado del código (2026-11-17)

Verificado contra `origin/dokploy` (`845620a5`) — el destino de despliegue — y contra esta rama, que **va 2.351 commits atrás**. De ahí el paso obligatorio de cada historia: **integrar `origin/dokploy` por merge** antes de implementar (nunca rebase).

| Objeto | ¿Existe? | Dónde |
|---|---|---|
| `dominio.reparacion_avisos` (`canal`/`clave_envio` **no** existen todavía; `estado_envio` ∈ `pendiente|enviado|fallido`) | Sí | `supabase/migrations/20270201200133_reparacion_avisos.sql` |
| `public.avisar_cliente_reparacion(p_reparacion uuid, p_estado_id uuid default null)` | Sí | `20270201200134_avisar_cliente_reparacion.sql` |
| `public.avisos_de_reparacion(p_reparacion uuid)` | Sí | `20270201200135_avisos_de_reparacion.sql` |
| Flow de correo `reparaciones-aviso-correo` | Sí | `20270201200136_avisos_reparacion_flow.sql` |
| `lib/whatsapp.ts` (`normalizarNumero`, `urlWhatsapp`) | Sí | `apps/web/src/lib/whatsapp.ts` |
| `lib/enlaceConsulta.ts` + `public.obtener_enlace_consulta(p_reparacion uuid)` (exige `edicion`) | Sí, **solo en `dokploy`** | `20270219160100` / `20270219160200` |
| `dominio.reparaciones` (`tecnico_id`, `empresa_id`, `ingreso_en`, `entrega_real`, `anulada_en`, `contacto`) | Sí | `20261020110100_reparaciones.sql` |
| `dominio.reparacion_items` (`tipo` ∈ `mano_obra|repuesto`, `subtotal` sin IVA) | Sí | `20261022100100_reparacion_items.sql` |
| `dominio.estados_reparacion` (`nombre`, `descripcion` ≤ 500, `cierra`) | Sí | `20261020100200_estados_reparacion.sql` |
| `public.clientes` (`celular`, `telefono`) | Sí | `20261016130000_clientes_ficha_y_numeracion.sql` |
| `public.comprobante_de_reparacion(p_reparacion uuid)` + `dominio.comprobantes_venta.origen_tipo` (`check in ('reparacion')`) | Sí | `20270201200128`, `20270201200131` |
| `private.puede_accion(seccion, accion)` con `ver_costos` y `exportar` | Sí | `20261013130002_roles_basics_permisos.sql` |
| `public.tecnicos_de_service()` | Sí | `20261020110500_reparaciones_leer.sql` |
| `private.registrar_actividad(tipo, descripcion, empresa)` | Sí | `20261016120000_registro_actividad.sql` |
| `private.conjuntos_exportacion_total()` | Sí | `20270217300003_exportacion_total_conjuntos.sql` |
| `lib/exportarCsv.ts` (`armarCsv`, `TOPE_FILAS_EXPORTACION`, `nombreArchivoCsv` con unión **cerrada** de prefijos) | Sí, **solo en `dokploy`** | `apps/web/src/lib/exportarCsv.ts` |
| `components/base/{EtiquetaEstado,TituloDialogo}.tsx`, `components/pagina/{CargaInfinita,ContenidoAdaptable,FiltroEmpresa}.tsx`, `hooks/useListadoAcumulado.ts` | Sí, **solo en `dokploy`** | MSF-117 |
| `apps/web/src/ayuda/contenidos/service.ts`, `ayuda/manualPorDestino.ts` | Sí, **solo en `dokploy`** | `apps/web/src/ayuda/` |
| `actualizar_reparacion` **permite** cambiar el `tecnico_id` de una reparación entregada (no mira `entrega_real`) | Sí | `20261020110400_reparaciones_actualizar.sql` → el disparador de FR-028 aplica |
| Librería de QR en `apps/web/package.json` / `pnpm-lock.yaml` | No | — (D-18) |

**Objetos que esta spec propone y que NO existen todavía** (se crean por migración aditiva, nunca a mano): `dominio.comision_reglas`, `private.regla_comision`, `private.comisiones_calculadas`, `public.datos_aviso_whatsapp`, `public.registrar_aviso_whatsapp`, `public.guardar_regla_comision`, `public.listar_reglas_comision`, `public.comisiones_resumen`, `public.comisiones_detalle`, las columnas `canal` y `clave_envio` de `dominio.reparacion_avisos`, el índice parcial de `dominio.reparaciones`, y el front `apps/web/src/lib/qr/`, `lib/avisoWhatsapp.ts`, `lib/comisiones.ts`, `lib/etiquetaReparacion.ts`.

## Esquemas y reversión (aditivo)

Versiones **provisionales** a partir de `20270508100000` (el máximo de `origin/dokploy` el 2026-11-17 es `20270507130100`; hay otras ramas en vuelo). **Se ajustan al implementar**: antes de cada historia se integra `origin/dokploy` por merge (nunca rebase), se lee el máximo real y se renumera con margen con `node scripts/verificar-migraciones.mjs`. F-SVC-32 **no tiene migraciones**.

| Migración | Historia | Objetos (esquema) | Reversión (migración posterior, nunca en el mismo PR) |
|---|---|---|---|
| `20270508100000_reparacion_avisos_whatsapp.sql` | F-SVC-30 | `dominio.reparacion_avisos` (`dominio`): columnas `canal` y `clave_envio`, `check` de `estado_envio` con `abierto`, `check` de coherencia canal/estado, índice único parcial, `grant select (canal)` | borrar o exportar antes las filas `canal = 'whatsapp'`; `drop` del `check` de coherencia y del índice; `drop column clave_envio, canal`; restaurar el `check` de `estado_envio` de `20270201200133` |
| `20270508100100_datos_aviso_whatsapp.sql` | F-SVC-30 | `public.datos_aviso_whatsapp` (`public`) | `drop function public.datos_aviso_whatsapp(uuid)` |
| `20270508100200_registrar_aviso_whatsapp.sql` | F-SVC-30 | `public.registrar_aviso_whatsapp` (`public`); `public.avisos_de_reparacion` con `canal` (misma firma) | `drop function public.registrar_aviso_whatsapp(uuid, uuid, text, uuid)`; restaurar `avisos_de_reparacion` de `20270201200135` |
| `20270508110000_comision_reglas.sql` | F-SVC-31 | `dominio.comision_reglas` (**tabla**, `dominio`) con RLS, único por alcance y vigencia, disparador de membresía del técnico | `drop table dominio.comision_reglas` (exportar antes) |
| `20270508110100_reparaciones_entregadas_indice.sql` | F-SVC-31 | índice parcial `reparaciones (organizacion_id, entrega_real) where entrega_real is not null and anulada_en is null` (`dominio`) | `drop index` |
| `20270508110200_calculo_comisiones.sql` | F-SVC-31 | `private.regla_comision`, `private.comisiones_calculadas` (`private`) | `drop function` de cada una |
| `20270508110300_comisiones_rpc.sql` | F-SVC-31 | `public.guardar_regla_comision`, `listar_reglas_comision`, `comisiones_resumen`, `comisiones_detalle` (`public`) | `drop function` de cada una |
| `20270508110400_reparaciones_tecnico_entregada.sql` | F-SVC-31 | regla de `tecnico_id` en `private.validar_reparacion()` (o disparador nuevo) — **solo si** `actualizar_reparacion` sigue permitiendo cambiar el técnico de una entregada (hoy sí: T040) | restaurar `private.validar_reparacion` de su versión anterior |
| `20270508110500_exportacion_total_comision_reglas.sql` | F-SVC-31 | `private.conjuntos_exportacion_total()` incluye `dominio.comision_reglas` | restaurar la versión anterior de la función |

El cambio de `check` de `estado_envio` sigue el patrón de `20261203200200_accion_editar_precio.sql` (drop + add del constraint con las filas previas válidas); se confirma que `pnpm test:db:validar-aditivas` y `pnpm test:db:guard-migraciones` lo aceptan y, si no, se agrega el motivo en la propia migración como hacen las demás.

**Re-verificación del Principio VII, objeto por objeto** (se repite en tareas, implementación y revisión del PR):

| Objeto | Esquema declarado | Por qué no el otro | RLS | Privilegios |
|---|---|---|---|---|
| `dominio.comision_reglas` | `dominio` | Regla de negocio del taller; no es identidad ni plataforma | Habilitada; org + `service_tecnico` ≥ lectura + `ver_costos` | `select` a `authenticated`; sin escritura; `anon` nada |
| `dominio.reparacion_avisos` (alterada) | `dominio` | Ya es entidad de negocio de Service (MSF-232) | Vigente | `canal` suma a las columnas con `select`; sin escritura directa |
| RPC `public.*` (seis) | `public` | Superficie RPC del panel (convención de Service); sin tablas | — | `revoke … from public, anon`; `grant … to authenticated` |
| `private.regla_comision`, `private.comisiones_calculadas` | `private` | Lógica sin datos | — | Sin `execute` para la API |

`rls_en_toda_tabla` (recorre `public` + `dominio`) debe pasar; `has_table_privilege('anon', 'dominio.comision_reglas', …)` = falso; `has_function_privilege('anon', …)` = falso para las seis RPC (la lista cerrada de funciones ejecutables por `anon` **no cambia**).

## Archivos que cambian (por historia)

| Historia | Archivo | Cambio | Validación |
|---|---|---|---|
| F-SVC-32 | `apps/web/src/lib/qr/{qr.ts,galois.ts,plantillas.ts,svg.ts}` | generador puro de QR | `qr.test.ts`, `qr.dorados.test.ts` (+ `fixtures/qr-dorados.json`) |
| F-SVC-32 | `apps/web/src/lib/etiquetaReparacion.ts` | URL, tamaños, preferencia, módulo mínimo | `etiquetaReparacion.test.ts` |
| F-SVC-32 | `apps/web/src/components/service/EtiquetaReparacion.tsx` | hoja de la etiqueta | `etiqueta.test.tsx` |
| F-SVC-32 | `apps/web/src/pages/service-tecnico/etiqueta.tsx`; `App.tsx` (ruta lazy) | vista P-4 | `etiqueta.test.tsx`, `App.guard.test.ts` |
| F-SVC-32 | `apps/web/src/pages/service-tecnico/reparacion.tsx` | botón «Imprimir etiqueta» (P-3) | `reparacion.test.tsx` |
| F-SVC-30 | `supabase/migrations/20270508100000…100200` | ver tabla de migraciones | `service_aviso_whatsapp.test.sql`, `service_avisos.test.sql` |
| F-SVC-30 | `apps/web/src/lib/avisoWhatsapp.ts` | plantilla, candidatos, llamadas a las RPC | `avisoWhatsapp.test.ts` |
| F-SVC-30 | `apps/web/src/components/service/AvisoWhatsappDialog.tsx` (+ hook de datos) | diálogo P-2 | `AvisoWhatsappDialog.test.tsx` |
| F-SVC-30 | `apps/web/src/components/service/AvisosReparacion.tsx`, `lib/reparacionAvisos.ts` (`canal`, estado `abierto`), `pages/service-tecnico/reparacion.tsx` | P-1 | `reparacion.avisos.test.tsx` |
| F-SVC-31 | `supabase/migrations/20270508110000…110500` | ver tabla de migraciones | `service_comisiones.test.sql`, `service_comisiones_volumen.test.sql` |
| F-SVC-31 | `apps/web/src/lib/comisiones.ts` | llamadas, formato, CSV, períodos | `comisiones.test.ts` |
| F-SVC-31 | `apps/web/src/lib/exportarCsv.ts` | ampliar la unión de prefijos de `nombreArchivoCsv` con `comisiones-service` (FR-033) | `exportarCsv.test.ts` |
| F-SVC-31 | `apps/web/src/pages/service-tecnico/comisiones.tsx`; `components/service/{DetalleComisionesDialog,ReglasComisionDialog}.tsx` | P-5, P-6, P-7 | `comisiones.test.tsx`, `DetalleComisionesDialog.test.tsx`, `ReglasComisionDialog.test.tsx` |
| F-SVC-31 | `components/service/PestanasService.tsx`, `components/navegacion/destinosPanel.ts`, `lib/permisos.ts`, `lib/recursosCondicionadosAFeature.ts`, `ayuda/manualPorDestino.ts`, `App.tsx` | pestaña, destino, ruta | tests existentes de navegación y permisos |
| Todas | `docs/service-avisos.md`, `docs/service-comisiones.md` (nuevo), `docs/service-etiqueta-qr.md` (nuevo), `docs/service-impresion.md`, `docs/service-tecnico.md` (índice), `docs/actividad.md`, `docs/seguridad-service-ideas-futuras.md` (nuevo), `docs/roadmap-template.md`, `apps/web/src/ayuda/contenidos/service.ts` | documentación y manual | `pnpm docs:check` |
| Cierre | `apps/web/e2e/service-ideas-futuras.e2e.ts` | recorrido de las tres historias | `pnpm test:e2e` |

## Orden de implementación (por historia, con checkpoints)

Se implementa **historia por historia** (CLAUDE.md), con `/clear` entre una y otra. Cada historia **integra antes `origin/dokploy` por merge**, renumera sus migraciones por encima del máximo del momento y termina con: pgTAP/Vitest (con axe a 320, 768 y 1440 px), guards locales, las **revisiones independientes** (QA y Código + Seguridad, marcadas `[REV]` en `tasks.md`) y su merge a `dokploy` con merge commit (`--no-ff`) **antes** de empezar la siguiente. Orden fijo (D-22): **F-SVC-32 → F-SVC-30 → F-SVC-31**; ninguna depende de otra, así que un atraso en una no frena a las demás.

### Fase 0 · Recontrol (transversal)

1. Integrar `origin/dokploy` y confirmar que siguen vigentes las afirmaciones de la spec (ver la tabla «Estado verificado del código»), correr `pnpm prototipo:inventario` y confirmar que los inventarios de `ServicioReparacion` y `ServicioReparaciones` no cambiaron (T001).

### Fase 1 · F-SVC-32 Etiqueta con QR (sin base de datos)

1. Generador `lib/qr/` y su verificación en tres capas (T002 a T006). **Criterio de abandono** (D-18): si los vectores dorados o el escaneo real no cierran tras corregir, se reemplaza por la dependencia de fallback (fijada exacta, con más de 14 días, sin dependencias transitivas, auditada con `supply-chain-security`) detrás de la misma interfaz `generarQr`, sin cambiar nada más.
2. `lib/etiquetaReparacion.ts`, hoja y vista, botón y ruta (T007 a T011); a11y, impresión y docs (T012 a T014).
3. `[REV]` QA y Código + Seguridad (T015, T016) y merge.

**Checkpoint F-SVC-32**: el QR escaneado con un decodificador independiente y con un celular da exactamente la URL de la reparación; la etiqueta no lleva datos personales; `package.json` y el lockfile sin cambios; la impresión sale del tamaño elegido.

### Fase 2 · F-SVC-30 Aviso por WhatsApp

1. Migraciones y pgTAP (T020 a T024): primero la tabla (la RPC de registro depende de las columnas), después la lectura, después el registro y `avisos_de_reparacion`.
2. Front: `lib/avisoWhatsapp.ts`, diálogo P-2, sección P-1 (T025 a T029); docs, ayuda y guards (T030, T031).
3. `[REV]` QA y Código + Seguridad (T032, T033) y merge.

**Checkpoint F-SVC-30**: el aviso por correo de MSF-232 sigue idéntico (su pgTAP y Vitest sin cambios); el diálogo abre `wa.me` con el mensaje exacto y deja un único registro «Abierto en WhatsApp»; el servidor no envía nada.

### Fase 3 · F-SVC-31 Comisiones

1. Verificar el hueco del técnico en entregadas (T040) y migraciones de tabla, índice, cálculo, RPC, disparador y exportación (T041 a T046), cada una con su pgTAP (T047 a T050), incluido el de **volumen** (T051).
2. Front: `lib/comisiones.ts`, pestaña y ruta, informe (P-5), detalle (P-6), reglas (P-7), CSV (T052 a T058); docs, ayuda y guards (T059, T060).
3. `[REV]` QA y Código + Seguridad (T061 a T063) y merge.

**Checkpoint F-SVC-31**: el ejemplo del escenario 3 da $ 2.750; resumen = Σ detalle; cambiar una regla no altera lo anterior a su vigencia; sin `ver_costos` no se ve nada; no hay acciones de pago.

### Fase 4 · Cierre (tarea de cierre, label `cierre`)

E2E de las tres historias, revisión de seguridad integral, manual, roadmap, seguimientos trazados, verificación en dev y chequeo de que ninguna tarea queda `[ ]` (T070 a T076).

## Pruebas por historia

| Historia | pgTAP | Vitest (con axe a 320/768/1440 donde hay pantalla) | E2E |
|---|---|---|---|
| F-SVC-32 | — (sin base) | `qr.test.ts`, `qr.dorados.test.ts`, `etiquetaReparacion.test.ts`, `etiqueta.test.tsx`, ampliación de `reparacion.test.tsx` | recorrido en `service-ideas-futuras.e2e.ts` |
| F-SVC-30 | `service_aviso_whatsapp.test.sql` (+ `service_avisos.test.sql` sin cambios) | `avisoWhatsapp.test.ts`, `AvisoWhatsappDialog.test.tsx`, ampliación de `reparacion.avisos.test.tsx` | idem |
| F-SVC-31 | `service_comisiones.test.sql`, `service_comisiones_volumen.test.sql`, completitud de exportación total | `comisiones.test.ts`, `comisiones.test.tsx`, `DetalleComisionesDialog.test.tsx`, `ReglasComisionDialog.test.tsx`, tests de `PestanasService`/`destinosPanel` | idem |

Los pgTAP de aislamiento usan **dos organizaciones y dos tiendas con acceso restringido** (el patrón de `service_cobro.test.sql`). Los Vitest cubren siempre el **cambio de empresa activa** (Principio VIII).

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R-1 | El generador de QR propio tiene un bug que no se ve en pruebas unitarias (un QR que «parece» válido y no lo es) | Tres capas de verificación (dorados, ida y vuelta, escaneo real con dos decodificadores) y criterio de abandono con fallback a una dependencia fijada (D-18); es la primera tarea del orden recomendado para fallar temprano |
| R-2 | El cálculo de comisiones se aparta de lo que el taller espera (qué es «mano de obra», cuándo se devenga) | Es determinista y con ejemplo numérico en la spec y la guía; las decisiones D-7 a D-15 están explicadas con su alternativa y cada una es una condición de la función SQL si el cliente cambia de idea |
| R-3 | Cambiar el técnico de una entregada hoy está permitido y el cliente lo usa | FR-028 permite el cambio con `ver_costos` (el mismo rol que ve las comisiones); verificado en `origin/dokploy`: hoy se puede cambiar, así que el disparador aplica |
| R-4 | `window.open` bloqueado por el navegador en el flujo de WhatsApp | Se abre dentro del clic, antes de registrar; si se bloquea se informa y no se registra (FR-006, amenaza 1.9) |
| R-5 | Colisión de numeración de migraciones con otras ramas | Recontrol y renumeración al empezar cada historia (T001 y primera tarea de cada fase) |
| R-6 | El `check` de `estado_envio` rompe el aviso por correo de MSF-232 | La migración conserva las filas previas válidas y el pgTAP/Vitest de MSF-232 corren sin cambios como regresión |
| R-7 | Volumen: el informe recorre muchas reparaciones | Índice parcial, una consulta agregada, rango máximo de 366 días y pgTAP de volumen (FR-036) |
| R-8 | La etiqueta queda con la dirección vieja si cambia el dominio del panel | Documentado en `docs/service-etiqueta-qr.md` (mantener la redirección del dominio viejo o reimprimir) |
| R-9 | El tamaño real de la etiqueta de cada impresora no coincide con los predefinidos | «Personalizada» cubre el resto; la guía explica la configuración del navegador (escala 100 %, sin márgenes) |
| R-10 | La rama de la spec va 2.351 commits atrás de `dokploy` y no tiene los componentes compartidos (FiltroEmpresa, CargaInfinita, `lib/exportarCsv.ts`, `ayuda/contenidos/service.ts`) | Cada historia integra `origin/dokploy` por merge como primer paso (T001, T020, T040) y vuelve a verificar la tabla «Estado verificado del código» |

## Cómo se deshace

Cada historia es un PR con merge commit: se revierte con `git revert -m 1 <hash>`. Las migraciones son aditivas; su reversión explícita está en la tabla de arriba y va **siempre** en una migración posterior y exportando antes los datos. F-SVC-32 se revierte sin tocar la base.
