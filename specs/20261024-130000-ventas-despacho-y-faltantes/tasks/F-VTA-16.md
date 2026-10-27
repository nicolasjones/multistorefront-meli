# Marcas de F-VTA-16 (reconciliado, PR #463)

Las tareas de **esta** historia quedaron hechas (la historia está **Finalizada**). Se reconcilia por si el Revisor no las marcó.
Vive en un archivo **por-historia** para no chocar el `tasks.md` compartido entre historias.

- [x] T013 — `supabase/migrations/20261214140100_envio_columnas.sql`: `transporte_id` (FK compuesta a `dominio.transportes (id, organizacion_id)`), `guia` (≤ 100) y `fecha_envio` en `dominio.comprobantes_venta` (alter aditiva, con reversión en el encabezado). Versión renumerada en `ee0a560e` (alineación con el plan) y otra vez en esta corrida, al bloque `20261214140100` (ver «Renumerado de migraciones» más abajo); verificado por el pgTAP de T016 (`8cdd7879`).
- [x] T014 — `supabase/migrations/20261214140200_envio_guardar.sql`: RPC `guardar_envio_comprobante` (`security definer`, sin grants de escritura nuevos y `anon` revocado): factura confirmada no entregada, transporte activo y usado en la empresa del comprobante, permiso `despachar` o `edicion`, bloqueo optimista (`40001`) y actividad `despacho.envio_guardado`. Verificado por el pgTAP de T016 (`8cdd7879`).
- [x] T015 — `supabase/migrations/20261214140300_envio_exige_al_entregar.sql`: disparador `before update of estado_despacho` que rechaza `entregado` cuando la forma de envío exige transporte y guía y falta alguno (`ce5de9f9`; el mensaje del rechazo se ajustó en `e5fd9385` para que la persona vea QUÉ falta). Reverificado en la sesión de la devolución del Revisor: el CI lo corrió en verde.
- [x] T016 — `supabase/tests/database/envio_transporte.test.sql`: pgTAP de FR-020, FR-021 y FR-022 (`8cdd7879`; rol de empresa corregido en `503fe6d2`, comparaciones con `matches` en `0ceee3d4`, factura sin forma de envío y prefijo del rechazo en `d4eb52f1`). Reverificado en la sesión de la devolución del Revisor: el CI lo corrió en verde.
- [x] T017 — `apps/web/src/lib/ventasEnvio.ts`: transportes elegibles por tipo de envío (Decisión abierta 8), rótulos del selector, texto de «Retiro en local», validación de la guía y envoltorios de lectura y guardado (`842b181a`; lectura por id del transporte cargado fuera del catálogo de la tienda en `f03b7a4e`). Verificado por `apps/web/src/lib/ventasEnvio.test.ts`.
- [x] T018 — `apps/web/src/components/ventas/EnvioTransporte.tsx` y su integración en `apps/web/src/pages/ventas/comprobante.tsx`: selector de transporte con rótulo por tipo, Guía, Fecha de envío, texto de «Retiro en local», estados del kit y cierre con aviso al cambiar la empresa activa (`842b181a`; bloque en solo lectura si la factura ya fue entregada, en `f03b7a4e` y `0c2aad5a`). La compuerta «solo factura confirmada» se cubre con `apps/web/src/pages/ventas/comprobante.envio.test.tsx`; ese test también cubre el rechazo de entrega por falta de transporte o guía (FR-022) tal como lo muestra el panel.
- [x] T019 — `apps/web/src/components/ventas/EnvioTransporte.test.tsx`: rótulos por tipo, retiro en local, error de guía faltante, `lectura` y cambio de empresa (`94d8b94f`; ampliado en `f03b7a4e`, `3376e914` y `d4eb52f1`; en la sesión 4/4, `80be4ef2`, se cerraron dos ramas sin assert propio: el aviso «Falta el transporte» —guía escrita y transporte sin elegir— y el motivo «(no corresponde a esta forma de envío)» del transporte ya cargado; ambas comprobadas con mutación).
- [x] T020 — `docs/ventas-despacho.md`: sección «Transporte y guía» (documenta FR-020…FR-023 y cita el test del bloque) (`ce5de9f9`; ampliada en `f03b7a4e` y `0c2aad5a`; en la sesión 4/4 cita también el test de página `comprobante.envio.test.tsx`, que es el que cubre la compuerta del bloque). Verificado por `pnpm docs:check`.

**Re-verificación de la devolución del 2026-10-27T13:07 (SHA `d068814a`, ronda 4/4)** — el Revisor volvió a mirar `d068814a`, que es anterior a las correcciones de la ronda 3/4; sus tres hallazgos (el «Reporte del agente (cola)» truncado, el `\n` final y la evidencia que la consolidación se había comido) y el hallazgo de seguridad quedan resueltos, con la evidencia comprobada en la ronda 4/4:

1. **«Reporte del agente (cola)» truncado** → resuelto en `1b5fc704`. En el HEAD la sección arranca con su encabezado `## Reporte del agente (cola)` y no queda fragmento huérfano (`grep -n '^## Reporte del agente'` → **una sola aparición** en `estado/MSF-166.md`; la cita por número de línea que había acá quedó sin base y se corrigió).
2. **El archivo sin `\n` final** → resuelto en `1b5fc704`; verificado de nuevo en la ronda 4/4 con `od -c` (último byte `\n`). El runner reescribe `estado/MSF-166.md` al arrancar cada sesión y lo deja otra vez sin `\n` y sin la evidencia: por eso se restauró antes de commitear y la evidencia durable quedó también acá.
3. **La evidencia que la consolidación se había comido** (el fix de `elegirResponsable` y la comprobación por mutación) → resuelta en `1b5fc704`: está escrita en el punto «Evidencia que el runner no se lleva» de este archivo, y las cuatro mutaciones se **re-midieron en la ronda 4/4** (ver arriba).

**Re-verificación de la devolución del Revisor (PR #463)** — los tres hallazgos accionables se comprobaron uno por uno: (1) las ocho tareas de esta historia quedan `[x]` **en el `tasks.md` de la épica** (`specs/20261024-130000-ventas-despacho-y-faltantes/tasks.md:48-55`), cada línea con su evidencia (archivo real + commit) al final, sin tocar el texto de la tarea; por orden explícito del CTO en esta corrida, y para que no quede ninguna `[ ]` de esta historia. Las tareas de las otras historias (F-VTA-15, F-VTA-17, F-VTA-18 y el cierre) no se tocan: no son de esta historia. Este archivo por historia conserva el detalle de la evidencia; (2) el par simétrico de tests de página existe (`apps/web/src/pages/ventas/comprobante.envio.test.tsx:163` factura confirmada → aparece, `:172` borrador → no aparece, `:180` presupuesto → no aparece, `:190` cambio de tienda, `:210` rechazo de entrega por falta de envío) y se comprobó con mutación de la compuerta `comprobante.tsx:728` (neutralizada la condición de `estado` falla el caso «borrador»; neutralizada además la de `tipo` fallan «borrador» y «presupuesto»: los tests muerden); (3) el archivo de estado `estado/MSF-166.md` quedó con su encabezado íntegro (lista numerada desde «1.») y con el `\n` final. Detalle en `estado/MSF-166.md`.

**Evidencia que el runner no se lleva** — `estado/MSF-166.md` lo reescribe el runner al arrancar cada sesión (pierde la evidencia de las rondas anteriores y queda sin `\n` final), así que lo que tiene que sobrevivir está **acá**:

- **Test intermitente de `elegirResponsable`** (hallazgo Media, resuelto en `c265fa13`): la tarjeta «Responsables» carga sus selectores de forma asíncrona, así que buscarlos de golpe volvía intermitente la prueba cuando el runner carga la máquina. El fix pasa la espera a `findByRole` (`apps/web/src/pages/ventas/comprobante.envio.test.tsx:205-206`, con el motivo comentado en `:202-203`).
- **Comprobación por mutación de la compuerta** (medida de nuevo en la sesión 4/4, sobre `apps/web/src/pages/ventas/comprobante.envio.test.tsx`): sin `comprobante.estado === 'confirmada'` en `comprobante.tsx:728` falla «en una factura sin confirmar no muestra el bloque» (1 failed | 4 passed); sin `comprobante.tipo === 'factura'` falla «en un presupuesto no muestra el bloque» (1 failed | 4 passed). `comprobante.tsx` quedó restaurado (`git diff` vacío). En la sesión 2/4 se midió una mutación más ancha (sin las dos condiciones a la vez) y fallaban ese caso y el del presupuesto (2 failed | 3 passed).
- **Mutaciones de la lectura del envío** (medidas de nuevo en la sesión 4/4): con la lectura de vuelta contra la tabla (`from('comprobantes_venta')` en vez de la RPC `obtener_envio_comprobante`, en `apps/web/src/lib/ventasEnvio.ts`) fallan 3 pruebas de `apps/web/src/lib/ventasEnvio.test.ts` (3 failed | 16 passed); con el bloque volviendo a mandar la empresa al leer (`obtenerEnvioComprobante(comprobanteId, empresaId)`) falla «lee el envío por su id: el permiso lo resuelve la base, en la empresa del comprobante» (1 failed | 36 passed). Los dos archivos quedaron restaurados (`git diff` vacío).

**Corrección de seguridad (BOLA entre tiendas) — PR #463** — la RLS de `dominio.comprobantes_venta` (`supabase/migrations/20261018100000_ventas_contrato_comprobantes.sql:46-51`) resuelve organización + nivel de Ventas contra la **empresa activa** de la barra superior: no acota por la empresa del comprobante, así que una persona con Ventas en lectura en la tienda A podía leer el envío (transporte, guía y fecha) de un comprobante de la tienda B de la misma organización pasando su id. Primera corrección en `fa8b0b7e` (filtro por `empresa_id` en el cliente) y **cierre del lado de la base en la ronda 3/4** (el filtro del cliente no cerraba el hueco: el parámetro también lo elige quien llama):

- **RPC `public.obtener_envio_comprobante(p_id uuid)`** (`supabase/migrations/20261214140400_envio_leer.sql`): `security definer`, `stable`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`. Devuelve transporte, guía, fecha y `updated_at`; exige Ventas en `lectura` o `edicion` en la **empresa del comprobante** (`private.nivel_ventas_en_empresa`): `P0002` si el comprobante no existe, `42501` si no se puede ver esa tienda. Es el mismo patrón que `obtener_despacho_comprobante` (F-VTA-15) y `detalle_anulacion_nota_credito` (F-VTA-11): una RPC de lectura aparte, que no redefine la de otra historia. Migración **aditiva**: sin tablas nuevas, sin cambios de RLS ni de grants; reversión en el encabezado y en `docs/ventas-despacho.md` (punto 7 de «Reversión»).
- **Frontend**: `obtenerEnvioComprobante(comprobanteId)` (`apps/web/src/lib/ventasEnvio.ts:151-162`) lee por la RPC y ya no toca la tabla; el bloque la llama sin empresa (`apps/web/src/components/ventas/EnvioTransporte.tsx:138`).
- Pruebas: pgTAP `supabase/tests/database/envio_transporte.test.sql` (sección «La lectura del envío se resuelve en la empresa DEL comprobante»): con Ventas en lectura se lee el envío de la tienda propia, **no** el de otra tienda de la misma organización (`42501`), otra organización da `P0002`, un comprobante inexistente da `P0002` y `anon` no ejecuta la RPC. Vitest `apps/web/src/lib/ventasEnvio.test.ts` (la lectura va por la RPC y no por la tabla) y `apps/web/src/components/ventas/EnvioTransporte.test.tsx` (el bloque lee por id; los transportes elegibles son los de la empresa del comprobante). Con mutación (la lectura de vuelta contra la tabla) fallan 3 pruebas del primer archivo; con el bloque mandando la empresa, falla la del segundo.
- Documentación: `docs/ventas-despacho.md`, sección «Transporte y guía» (la RPC en la tabla de RPC, el porqué de no leer la tabla y la reversión).

**Renumerado de migraciones (esta corrida)** — la épica avanzó con el bloque de F-VTA-18 (`20261214130100`…`20261214130300`), así que las tres migraciones de esta historia quedaron por debajo de la máxima de la base y el guard `scripts/verificar-migraciones.mjs` las rechazaba en el CI («versión … REUSADA: usá una versión nueva y mayor»). Se renumeraron al bloque libre siguiente: `20261214140100_envio_columnas.sql`, `20261214140200_envio_guardar.sql` y `20261214140300_envio_exige_al_entregar.sql` — **contenido sin cambios: sólo el nombre del archivo**. Verificado con `node scripts/verificar-migraciones.mjs --base origin/epic/MSF-135-ventas-y-despacho-ventas-despacho-y-falt` → «Migraciones OK: 348 archivo(s), 3 nuevo(s)». Las referencias se actualizaron en `docs/ventas-despacho.md`, en `plan.md` y en el comentario del test de página (`comprobante.envio.test.tsx`).

**Reconciliación de la evidencia del `tasks.md` compartido (ronda 5/5, devolución del Revisor)** — las líneas de evidencia de T013–T015 del `tasks.md` **compartido** de la épica (`specs/20261024-130000-ventas-despacho-y-faltantes/tasks.md:48-50`) seguían citando los nombres anteriores (`supabase/migrations/20261214110100_envio_columnas.sql`, `…110200_envio_guardar.sql`, `…110300_envio_exige_al_entregar.sql`), que con el renumerado ya no existen: la evidencia quedaba no verificable. **En esta ronda se corrigieron solo esas tres líneas** (la ruta del archivo real y, entre paréntesis, el nombre que le daba el plan); no se tocó el texto de las tareas, ni las marcas, ni ninguna línea de otra historia. El detalle vigente de cada tarea sigue estando en este archivo por historia.

**Devolución del Revisor del 2026-10-27T15:32 (ronda 5/5, `a1ec3119`)** — los seis hallazgos quedan atendidos con evidencia en `estado/MSF-166.md`:

1. **Media** — el disparador de entrega (`20261214140300_envio_exige_al_entregar.sql`) miraba solo `exige_transporte_guia` e ignoraba el `tipo`: una forma «Retiro en local» creada desde el diálogo (la casilla de exigencia viene en «Sí» y cambiar el tipo no la desmarca) dejaba la factura sin poder **entregarse** nunca, porque el bloque de retiro en local no muestra los campos de transporte ni de guía. Ahora el disparador lee el `tipo`: «Retiro en local» nunca exige transporte ni guía (manda el tipo sobre la casilla). pgTAP: sección «FR-022 · «Retiro en local» con la casilla de exigencia marcada» (forma con `exige_transporte_guia = true`, se entrega sin transporte ni guía) + un assert sobre el cuerpo de la función (`prosrc`).
2. **Baja** — la fecha de envío por defecto usaba `current_date` (UTC): entre las 21:00 y las 23:59 de Argentina grababa el día siguiente. Ahora usa `private.hoy_argentina()`, como el resto de las RPC. pgTAP: la fecha guardada sin fecha es el día de Argentina + un assert sobre el cuerpo de la función.
3. **Baja** — `EnvioTransporte.tsx` dejaba el aviso «Envío guardado.» junto al error de una guía de más de 100 caracteres (`guardar` salía antes de limpiarlo). Ahora el aviso se limpia al empezar a guardar y al editar la guía. Vitest: «una guía inválida saca el aviso de éxito del guardado anterior».
4. **Baja** — evidencia de T013–T015 en el `tasks.md` compartido: reconciliada (ver arriba).
5. **Baja** — el «Reporte del agente (cola)» de `estado/MSF-166.md` arrancaba con un fragmento huérfano: la sección vuelve a arrancar con su encabezado y su contenido.
6. **Baja** — `COMO_REVERTIR` proponía `git revert -m 1 4cff4fd2` y ese commit no es un merge (un solo padre): ahora dice `git revert 4cff4fd2`.

**Re-verificación de la devolución del 2026-10-27T15:32 sobre `HEAD` (`312ca8e4`, re-despacho)** — se comprobó cada hallazgo contra el árbol actual (no se asumió nada) y los seis ya tienen su corrección en commits posteriores al SHA revisado (`333b671`):

1. **Media** → `a1ec3119`: el disparador selecciona el `tipo` (`supabase/migrations/20261214140300_envio_exige_al_entregar.sql:64`) y devuelve la fila sin exigir nada para `retiro_local` (`:73`). Lo ejercita el pgTAP «FR-022 · «Retiro en local» con la casilla de exigencia marcada» (`supabase/tests/database/envio_transporte.test.sql:742-763`).
2. **Baja** → `a1ec3119`: la fecha por defecto es `private.hoy_argentina()` (`supabase/migrations/20261214140200_envio_guardar.sql:102`), con assert sobre `prosrc` en el pgTAP (`envio_transporte.test.sql:420-422`).
3. **Baja** → `a1ec3119`: `guardar` limpia el éxito antes de validar la guía (`apps/web/src/components/ventas/EnvioTransporte.tsx:278`) y editar la guía también (`:381`); test «una guía inválida saca el aviso de éxito del guardado anterior» (`EnvioTransporte.test.tsx:341`).
4. **Baja** → `eea38fd5`: `tasks.md:48-50` cita los archivos reales `20261214140100`/`…140200`/`…140300`.
5. **Baja** → `eea38fd5`: el «Reporte del agente (cola)» de `estado/MSF-166.md` vuelve a arrancar con su encabezado («## Reporte del agente (cola)») y no queda el fragmento huérfano. La comprobación durable es **por comando** (el runner reescribe el estado en cada sesión y los números de línea cambian): `grep -n '^## Reporte del agente' specs/20261024-130000-ventas-despacho-y-faltantes/estado/MSF-166.md` → **una sola aparición**, y la línea siguiente es la primera viñeta del reporte.
6. **Baja** → `eea38fd5`: el `COMO_REVERTIR` del estado dice `git revert 4cff4fd2` (sin `-m 1`). Comprobación por comando: `grep -n 'git revert 4cff4fd2' specs/20261024-130000-ventas-despacho-y-faltantes/estado/MSF-166.md`.

Verificación local de esta re-revisión: `pnpm --filter @platform/web test --run EnvioTransporte ventasEnvio comprobante.envio comprobante.despacho` → 66/66 (4 archivos); `pnpm lint` → exit 0; `pnpm build` → exit 0; `DOCUMENTATION_CHECK_BASE=origin/epic/MSF-135-… pnpm docs:check` → OK (17 archivos, 349 migraciones). El pgTAP queda al job `database` del CI (sin socket de Docker local).

**Ronda 6/6 — la corrección del hallazgo 3 no estaba totalmente atada a un test** — al comprobar la devolución con
**mutación** (neutralizar el código y ver qué test falla) apareció un hueco real: el `setExito(null)` que el Revisor
nombró (el que corre *al empezar a guardar*, `apps/web/src/components/ventas/EnvioTransporte.tsx:278`) no estaba
cubierto por ningún test. El test que había («una guía inválida saca el aviso de éxito del guardado anterior») pasa
gracias al **otro** `setExito(null)`, el de editar la guía (`:381`): al sacar solo el de `guardar`, los 38 tests
seguían en verde. O sea que la corrección de la base podía volver a caerse sin que nadie lo notara.

- **Qué se agregó**: `apps/web/src/components/ventas/EnvioTransporte.test.tsx`, test «un guardado que falla no deja el
  aviso de éxito del guardado anterior» (sección «Guardar el envío»): guardar bien (queda «Envío guardado.»), cambiar
  la **fecha** (que, a diferencia de la guía, no saca el aviso) y guardar otra vez con la base rechazando. El error
  tiene que quedar solo: el aviso viejo no puede seguir al lado.
- **Medido**: con `setExito(null)` de `guardar` neutralizado, ese test **falla** (1 failed | 38 passed) y el resto
  sigue en verde → el test muerde exactamente el mecanismo que el Revisor señaló. Con el código entero, 39/39 en verde.
  Revertir las dos correcciones a la vez (como estaban en `333b671`) también falla el test ya existente.
- **Documentación**: `docs/ventas-despacho.md` (sección «Transporte y guía») ahora dice que el aviso se limpia **al
  empezar cada intento de guardado**, no solo al editar la guía: es la regla que el test nuevo ata.

Los seis hallazgos siguen atendidos como antes (commits `a1ec3119` y `eea38fd5`); esta ronda no los volvió a tocar,
solo cerró el test que faltaba para que la corrección del hallazgo 3 no se pueda perder en silencio.

Verificación local de esta ronda: `pnpm --filter @platform/web test --run EnvioTransporte ventasEnvio comprobante.envio comprobante.despacho` → 67/67 (4 archivos); `pnpm lint` → exit 0; `pnpm build` → exit 0; `DOCUMENTATION_CHECK_BASE=origin/epic/MSF-135-… pnpm docs:check` → OK. El pgTAP queda al job `database` del CI (sin socket de Docker local).

**Ronda 7/7 — la pantalla no tenía atada la regla «manda el tipo sobre la casilla» (esta corrida)** — la QA volvió a
mirar el SHA `333b671` (anterior a las correcciones) y repitió los mismos seis hallazgos. Los seis se comprobaron
uno por uno contra el árbol actual, con evidencia, y todos tienen su corrección en commits **posteriores** al SHA
revisado (`a1ec3119`, `eea38fd5`, `312ca8e4`, `8e67535e`, `c259f633`); el detalle por hallazgo está en
`estado/MSF-166.md` (sección «Devolución del Revisor … ronda 7/7»). Lo que faltaba era del lado de la pantalla:

- **Qué faltaba**: la regla «manda el tipo sobre la casilla de exigencia» la tenía la base (pgTAP) y la tenía la
  pantalla, pero **nada la ataba en la pantalla**: una forma «Retiro en local» con la casilla de exigencia marcada
  (que es como la deja el diálogo de formas de envío, porque cambiar el tipo no la desmarca) no tenía ningún test en
  el bloque. Si alguien llegara a renderizar el aviso de «qué falta» también en la rama de retiro en local, la
  pantalla avisaría «Faltan el transporte y la guía» sin que haya dónde cargarlos, y contradiría el texto de
  «Retiro en local» — el mismo camino que el Revisor señaló en la base.
- **Qué se agregó**: `apps/web/src/components/ventas/EnvioTransporte.test.tsx`, caso «con «Retiro en local» y la
  casilla de exigencia marcada no avisa que falta nada»: el bloque muestra el texto de retiro en local, no avisa que
  falte el transporte o la guía, no muestra los campos de guía ni de transporte y no ofrece Guardar.
- **Medido por mutación**: renderizando el aviso de «qué falta» también en la rama de retiro en local, ese test
  **falla** (1 failed | 39 passed) y el resto sigue en verde → el test muerde el mecanismo. Con el componente
  restaurado, 40/40 en verde (`git diff` del componente vacío).
- **Lo que NO se tocó**: la pantalla ya se comportaba bien (el aviso de «qué falta» se renderiza solo en la rama con
  los campos, `apps/web/src/components/ventas/EnvioTransporte.tsx:407`), así que no hubo que cambiar código de
  runtime; y no se tocó el diálogo de formas de envío (`apps/web/src/lib/ventas/formasEnvio.ts`,
  `apps/web/src/components/ventas/FormaEnvioDialog.tsx`), que es de **otra** historia (F-VTA-02): la casilla que
  queda marcada es inerte, porque el tipo manda tanto en la base como en la pantalla.

**El runner reescribió `estado/MSF-166.md` al arrancar esta sesión** (lo hizo otra vez: lo dejó con el «Reporte del
agente (cola)» arrancando en un fragmento huérfano y sin el `\n` final, o sea con los hallazgos 5 y 6 de la QA
volviendo). Se restauró (`git restore`) antes de commitear y la evidencia de esta ronda quedó también en este
archivo, que es el que el runner no se lleva.

Verificación local de esta ronda: `pnpm --filter @platform/web test --run EnvioTransporte ventasEnvio comprobante.envio comprobante.despacho` → 68/68 (4 archivos); `pnpm lint` → exit 0; `pnpm build` → exit 0; `DOCUMENTATION_CHECK_BASE=origin/epic/MSF-135-… pnpm docs:check` → OK (17 archivos, 349 migraciones); `pnpm calidad:code` → oxlint/knip/jscpd/dependency-cruiser/syncpack ok. El pgTAP queda al job `database` del CI (sin socket de Docker local).

**Ronda 8/8 — la lectura del envío queda aislada también del lado de la TABLA (esta corrida)** — la devolución de
seguridad pidió cerrar el BOLA entre tiendas: la RPC `obtener_envio_comprobante` protegía la lectura de la app, pero
`dominio.comprobantes_venta` seguía con `grant select` de tabla y `dominio` está expuesto por PostgREST, así que una
persona con Ventas en lectura en la tienda A leía `transporte_id`, `guia` y `fecha_envio` de una factura de la tienda
B de la misma organización con solo pasarle el id. La RPC sola no cerraba el hueco: cerraba la lectura de la app, no
la de la tabla.

- **Migración** `supabase/migrations/20261214140500_envio_aislamiento.sql`: se revoca el privilegio de lectura de
  **tabla** y se concede **por columna** (las 31 columnas de la factura que no son del envío). Las tres columnas del
  envío quedan **sin privilegio** para `authenticated`: ni la app ni una llamada directa a la API las leen. Es
  aditiva (no toca datos, columnas ni RLS) y su reversión está en el encabezado. Es el mismo patrón del repo para
  esconder columnas sensibles (`public.cola_eventos`, `public.conexiones_oauth`).
- **Lo que NO cambia**: la escritura del envío sigue siendo solo de `guardar_envio_comprobante` (T014) y el
  disparador de FR-022 (T015) sigue leyendo las columnas del envío como `security definer` (o sea, como dueño de la
  tabla). El frontend no cambia: ya leía por la RPC.
- **pgTAP** `supabase/tests/database/envio_transporte.test.sql`: `authenticated` **no** tiene privilegio de lectura
  sobre las tres columnas del envío; leerlas directo de la tabla falla con `42501` (no es solo el catálogo); las
  demás columnas de la factura sí se leen; y **ninguna columna quedó sin conceder** (si una historia siguiente
  agrega una columna, el CI avisa en vez de dejarla invisible en producción). Los asserts que leían las columnas
  del envío directo de la tabla ahora pasan por un ayudante `security definer` del propio test.
- **Consecuencia en el test de F-VTA-15** (`supabase/tests/database/despacho_columnas_estado.test.sql`): el assert
  comprobaba el privilegio de **tabla**; ahora comprueba el de **columna** (misma propiedad: `authenticated` lee los
  comprobantes con RLS). No cambia el comportamiento del despacho: solo deja de depender del mecanismo que cambió.
- **Docs**: `docs/ventas-despacho.md` (el aislamiento, la RPC como única lectura, el aviso para las columnas nuevas
  y el punto de reversión).
- **Verificación local**: `pnpm --filter @platform/web test --run EnvioTransporte ventasEnvio comprobante.envio
  comprobante.despacho` → 68/68; `pnpm lint` → exit 0; `pnpm build` → exit 0; `pnpm docs:check` → OK (19 archivos,
  350 migraciones); `pnpm db:validar:aditivas` → 350 migraciones, ninguna destructiva sin reversión documentada;
  `pnpm calidad:code` → oxlint/knip/jscpd/dependency-cruiser/syncpack ok. El **pgTAP queda al job `database` del CI**
  (este entorno no tiene socket de Docker).

**Ronda 9/9 — devolución del 2026-10-27T18:08 (SHA revisado `8747dc9a`)** — el Revisor volvió a mirar `8747dc9a`,
que es anterior al cierre del aislamiento de la tabla (`10edd9c9`): sus tres hallazgos se comprueban uno por uno
contra el árbol actual, sin asumir nada.

1. **Baja · el «Reporte del agente (cola)» truncado** (`estado/MSF-166.md:26` en el SHA revisado: la primera línea
   de la sección había quedado partida, o sea que el reporte arrancaba en un fragmento huérfano) → **resuelto**. En
   el árbol actual la sección arranca con su encabezado y trae su contenido completo, y la cita rota por número de
   línea (la que señalaba la línea 165 del archivo de estado) ya no está: se quitó en `10edd9c9`. La verificación
   durable es **por comando**, no por número de línea (el runner reescribe el estado en cada sesión y los números de
   línea cambian):

   ```
   grep -n '^## Reporte del agente' specs/20261024-130000-ventas-despacho-y-faltantes/estado/MSF-166.md
   ```

   → **una sola aparición**, y la línea que sigue es la primera viñeta completa del reporte.

2. **Baja · el archivo sin `\n` final** (`estado/MSF-166.md:38` en el SHA revisado: el último byte era `.`) →
   **resuelto**: el archivo del estado cierra con `\n` (comprobable con `od -c` sobre el último byte). Como el
   runner lo deja otra vez sin `\n` al arrancar cada sesión, se restaura antes de commitear y la comprobación queda
   escrita acá (este archivo es el que el runner no se lleva).

3. **Alta · la tabla seguía expuesta a lectura directa entre tiendas** (la RPC `obtener_envio_comprobante` protegía
   la lectura de la app, pero `dominio.comprobantes_venta` conservaba el `grant select` de tabla y `dominio` está
   expuesto por PostgREST) → **cerrado en `10edd9c9`**, un commit **posterior** al SHA revisado:

   - `supabase/migrations/20261214140500_envio_aislamiento.sql:36` revoca el privilegio de lectura de **tabla** y
     `:40-50` lo concede **por columna**: `transporte_id`, `guia` y `fecha_envio` quedan **sin privilegio** para
     `authenticated` (ni la app ni una llamada directa a la API las leen); las demás columnas de la factura se leen
     igual, con la misma RLS. Migración **aditiva**: sin tablas, sin columnas, sin datos y sin cambios de RLS.
   - pgTAP `supabase/tests/database/envio_transporte.test.sql:293-334`: `authenticated` **no** tiene privilegio de
     lectura sobre las tres columnas del envío, **leerlas directo de la tabla falla con `42501`** (no es solo el
     catálogo), las demás columnas sí se leen y **ninguna columna quedó sin conceder** (si una historia nueva
     agrega una, el CI avisa).
   - Consecuencia en el test de F-VTA-15 (`supabase/tests/database/despacho_columnas_estado.test.sql`): el assert que
     comprobaba el privilegio de **tabla** ahora comprueba el de **columna** (misma propiedad, mecanismo nuevo).
   - Docs: `docs/ventas-despacho.md:94-96` (la tabla tampoco deja leer el envío directo), `:174` (la RPC es la única
     lectura del envío), `:278-279` (los asserts del pgTAP) y `:325-326` (el punto de reversión).

   Lo que **no** cambia: la escritura del envío sigue siendo solo de `guardar_envio_comprobante` (T014) y el
   disparador de FR-022 (T015) sigue leyendo las columnas del envío como `security definer`. El frontend ya leía
   por la RPC: no se tocó.

Verificación local de esta ronda: `pnpm --filter @platform/web test --run EnvioTransporte ventasEnvio
comprobante.envio comprobante.despacho` → **68/68** (4 archivos); `pnpm lint` → exit 0; `pnpm build` → exit 0;
`DOCUMENTATION_CHECK_BASE=origin/epic/MSF-135-… pnpm docs:check` → OK (19 archivos, 350 migraciones, 5 nuevas contra
la épica); `pnpm db:validar:aditivas` → 350 migraciones, ninguna destructiva sin reversión documentada;
`pnpm calidad:code` → oxlint/knip/jscpd/dependency-cruiser/syncpack ok. El **pgTAP queda al job `database` del CI**
(este entorno no tiene socket de Docker).

**Ronda 10/10 — la misma devolución (2026-10-27T18:08, SHA `8747dc9a`) re-verificada sobre `9af86a6d`** — llega
otra vez la devolución del SHA anterior a las correcciones, así que se comprobó de nuevo con comandos y no se tocó
código:

- `grep -n '^## Reporte del agente' specs/20261024-130000-ventas-despacho-y-faltantes/estado/MSF-166.md` → **una
  sola aparición**, con el contenido completo de la sección (sin el fragmento huérfano que se veía en el SHA
  revisado).
- `tail -c 40 specs/20261024-130000-ventas-despacho-y-faltantes/estado/MSF-166.md | od -c | tail -3` → el último
  byte es `\n`.
- `grep -rn 'MSF-166[.]md:165' specs/20261024-130000-ventas-despacho-y-faltantes/` → **sin resultados** (la cita rota
  por número de línea no existe).
- `supabase/migrations/20261214140500_envio_aislamiento.sql` presente desde `10edd9c9`: revoca el `select` de tabla
  y concede por columna sin `transporte_id`, `guia` ni `fecha_envio`; el pgTAP que lo prueba está en
  `supabase/tests/database/envio_transporte.test.sql` (sección «FR-020 · Las columnas del envío y su frontera de
  datos»). El job `database` del CI es el que lo corre.

Verificación local de la ronda 10/10 (HEAD `9af86a6d` + esta nota): `pnpm --filter @platform/web test --run
EnvioTransporte ventasEnvio comprobante.envio comprobante.despacho` → **68/68** (4 archivos, 75.34 s); `pnpm lint`
→ exit 0 (solo warnings preexistentes); `pnpm build` → exit 0 (3.11 s); `DOCUMENTATION_CHECK_BASE=origin/epic/MSF-135-…
pnpm docs:check` → OK (19 archivos; 350 migraciones, 12 nuevas contra `origin/dokploy`); `pnpm db:validar:aditivas`
→ 350 migraciones, ninguna destructiva sin reversión documentada; `pnpm calidad:code` → oxlint/knip/jscpd/
dependency-cruiser/syncpack ok. El **pgTAP queda al job `database` del CI** (este entorno no tiene socket de Docker).

