# Bug Assessment: Pérdida silenciosa de ediciones al reintentar «Compra para» (Proveedores) y «Responder por…» (Consultas)

- **Slug**: msf-698 (provisto por el usuario)
- **Created**: 2026-11-01
- **Source**: pasted text — «[Bug] Pérdida silenciosa de ediciones: reintentar «Compra para» en Proveedores y «Responder por…» en Consultas descartan lo que el usuario acaba de cambiar (It's a Plan MSF-698)» (sin URL; no se consultó Jira)
- **Verdict**: valid (perdida de datos de usuario por reintentos que reproducen una foto congelada del registro en lugar de reaplicar lo que el usuario acaba de escribir)
- **Severity**: high

## Report (verbatim or summarized)

«[Bug] Pérdida silenciosa de ediciones: reintentar «Compra para» en Proveedores y «Responder por…» en Consultas
descartan lo que el usuario acaba de cambiar (It's a Plan MSF-698) slug=msf-698».

No hay URL: el reporte es texto plano. No se consultó Jira ni ninguna fuente externa.

## Symptom

En las dos pantallas el reintento de una escritura parcial **reproduce la última foto conocida del registro**
(la que se leyó al abrir el diálogo) en lugar de **reaplicar el estado actual del formulario**. Lo que la persona
acababa de cambiar en el formulario (en Consultas: «Estado», «Responsable» y «Nota interna»; en Proveedores: los
campos del proveedor editados después del fallo) se descarta sin aviso: no se guarda, no se avisa y la pantalla
llega a mostrar un estado de éxito.

Esperado: un reintento debe reintentar **lo que el usuario quiere guardar**, no volver a escribir la versión
anterior del registro; y si el reintento no puede preservar lo editado, debe decirlo (o preservar el borrador)
antes de descartarlo.

## Reproduction

### Consultas · «Responder por…» con «Reintentar» (reproducible sin fallo previo)

1. Abrir Consultas → una consulta (`/consultas?consulta=<id>`) con permiso de edición.
2. En el detalle, cambiar «Estado» y escribir texto en «Nota interna» (quedan **sin guardar**: el formulario los
   tiene en estado local).
3. Pulsar «Responder por WhatsApp» / «Responder por correo».
   → `registrarRespuesta` escribe `consulta.estado`, `consulta.responsable_id` y `consulta.nota_interna`
   (**la foto que se leyó al abrir el diálogo**), no lo que está en el formulario.
4. Si el registro falla (red / 40001 / 42501) aparece el aviso «No se registró la respuesta.» con el botón
   **«Reintentar»**. Al pulsarlo se repite exactamente el mismo paso 3: se vuelve a escribir la foto vieja.
5. Si el reintento tiene éxito, `onGuardado` **cierra el diálogo** (`cerrarDetalle()`): la «Nota interna» y el
   «Estado» escritos en el paso 2 quedan sin guardar y sin ningún aviso. Lo que el usuario «acababa de cambiar»
   desapareció.
6. Variante con el mismo efecto: si en el paso 3 el registro **sí** sale, el `updated_at` de la fila cambia pero el
   detalle conserva el sello viejo (`useConsulta` no se suscribe a la revisión). El «Guardar» posterior del
   formulario falla con 40001 → «La consulta cambió.» → «Recargar» → `detalle.refetch()` → cambia el `updated_at` →
   cambia la `key` de `Formulario` → **el formulario se remonta y vuelve a los valores del servidor**: los cambios
   pendientes se pierden otra vez.

### Proveedores · reintento de «Compra para»

1. Ficha de un proveedor → «Editar» (o Proveedores → «Nuevo proveedor»).
2. Completar/editar los campos y marcar tiendas en «Compra para».
3. Pulsar «Guardar proveedor»: el proveedor se guarda bien, pero `guardar_empresas_de_proveedor` falla
   (red / 42501). Aparece el aviso «El proveedor se guardó, pero no pudimos guardar «Compra para».».
4. Cambiar algo más del formulario (por ejemplo la razón social) y **pulsar «Guardar proveedor» otra vez**
   (es el «reintento» del que habla `docs/proveedores.md`: «el reintento no lo duplica»).
   → Como `persistido.current` ya está seteado, el reintento **omite `actualizar_proveedor`** y solo vuelve a
   mandar las tiendas: **el cambio hecho en el paso 4 nunca se persiste**.
5. El diálogo se cierra con «Proveedor guardado»: la persona cree que todo quedó guardado, pero el campo editado
   en el paso 4 se perdió.

[NEEDS CLARIFICATION: en Proveedores el aviso de «Compra para» fallida **no** ofrece un botón «Reintentar»
(solo lo ofrece el conflicto de edición, `ProveedorFormDialog.tsx:159`); el reintento es implícito, un segundo
«Guardar proveedor». Falta confirmar si el reporte se refiere a ese reintento implícito o a un botón «Reintentar»
de las tiendas que no llegaría a verse (las casillas no se renderizan con error de carga: `SelectorEmpresas.tsx:50-53`
muestra un texto auxiliar, sin botón).]

[NEEDS CLARIFICATION: ¿la persona que reportó el bug vio el caso de Consultas con un fallo previo (para que
apareciera el botón «Reintentar») o también el primer clic de «Responder por…»? El primero ya pierde las ediciones
sin que haya ningún fallo.]

## Suspected Code Paths

### Consultas (mitad más clara)

- `apps/web/src/components/consultas/DetalleConsulta.tsx:46-48` — el formulario guarda en **estado local** lo que
  la persona editó (`estado`, `responsableId`, `nota`); ese estado es el que «Guardar» persiste.
- `apps/web/src/lib/responderConsulta.ts:60-75` — `registrarRespuesta(consulta)` escribe `nota: consulta.nota_interna ?? ''`
  (línea 71) y `estado`/`responsableId` de `cambiosAlResponder(consulta, usuarioId)` (líneas 66-73): **valores de la
  foto leída, no del formulario**.
- `apps/web/src/lib/responderConsulta.ts:37-45` — `cambiosAlResponder` deriva de `consulta.estado` y
  `consulta.responsable_id` (foto), no del estado local.
- `apps/web/src/components/consultas/DetalleConsulta.tsx:90-108` — `registrar()`: el «Reintentar» de la línea 131
  (`errorServidor.alResponder ? () => void registrar() : undefined`, `etiquetaReintentar='Reintentar'`, línea 132)
  llama a esta misma función: **repite la sobrescritura con la foto vieja**.
- `apps/web/src/components/consultas/DetalleConsulta.tsx:112-116` — `responder()`: el primer clic de «Responder por…»
  ya entra por este camino (`window.open` + `registrar()`).
- `apps/web/src/components/consultas/DetalleConsulta.tsx:40` — `<Formulario key={`${props.consulta.id}|${props.consulta.updated_at}`}>`:
  cuando cambia el `updated_at` (tras «Recargar») **el formulario se remonta y se reinicia con los valores del
  servidor** → se pierden los cambios pendientes.
- `apps/web/src/pages/consultas/list.tsx:292-303` — `onRecargar={() => void detalle.refetch()}` (dispara el remount) y
  `onGuardado` → `cerrarDetalle()` (cierra el diálogo y borra lo pendiente).
- `apps/web/src/hooks/useConsultas.ts:89` — `useConsulta` recarga solo con `[id, clave]`: **no** se suscribe a
  `revisionConsultas`, así que tras el registro de la respuesta el detalle conserva un `updated_at` viejo → el
  «Guardar» posterior da 40001.
- `apps/web/src/lib/consultas.ts:182-191` — `actualizarConsulta` llama `notificarCambioConsultas()` (línea 191): la
  bandeja se refresca, el detalle no.

### Proveedores

- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx:69-73` — `seleccion` (estado local) y
  `compraPara = seleccion ?? guardadas.empresas`: «Compra para» sí se reenvía con el valor actual.
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx:75` — `persistido` (`useRef`): marca que el
  proveedor ya se guardó.
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx:112-116` — `if (!persistido.current) { … actualizarProveedor(…) }`:
  **en el reintento la escritura del proveedor se omite**, así que solo se reenvían las tiendas.
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx:118-128` — bloque que guarda «Compra para» y arma el
  aviso «El proveedor se guardó, pero no pudimos guardar «Compra para».» (línea 123).
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx:155-162` — el `EstadoError`: título «No se guardó el
  proveedor.» (línea 157) **contradice su propio cuerpo** («El proveedor se guardó, pero…») y el botón de reintento
  solo existe para el conflicto (línea 159), no para el fallo de «Compra para».
- `apps/web/src/hooks/useEmpresasDeProveedor.ts:13-62` — hook de las tiendas guardadas (`cargar`/`refetch`).
- `apps/web/src/components/base/SelectorEmpresas.tsx:38-44` — `alternar` → `onCambiar` → `setSeleccion`.
- `apps/web/src/pages/proveedores/show.tsx:173-183` — `onGuardado` (refresca la ficha) y `onRecargar`
  (`setEditando(false); void cargar()`: **cierra el diálogo y descarta lo editado**, sin aviso).
- `apps/web/src/pages/proveedores/list.tsx:215-226` — el diálogo del listado, sin `onRecargar`.

### Contexto/documentación que fija la intención

- `docs/proveedores.md:98` — «Se guardan después del proveedor; si fallan, el aviso dice que el proveedor sí se guardó
  y **el reintento no lo duplica**». La intención declarada es solo «no duplicar»; no dice que el reintento deba
  re-guardar los campos, y el código tampoco lo hace.
- `docs/consultas.md:79-81` — «se mandan la nota y el `updated_at` **vigentes**» y «el detalle muestra el error con
  `Reintentar` (solo registra, no reabre la app)». «Vigente» se está tomando como «la foto leída», no como «lo que
  el usuario tiene en el formulario».
- `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx:220-232` — test que fija el comportamiento actual:
  «si fallan las tiendas avisa que el proveedor sí se guardó y **el reintento no lo duplica**» (asserta
  `mocks.rpc` llamado 1 vez y `guardarEmpresas` 2 veces). El test no cubre qué pasa con los campos editados entre
  intento y reintento.
- `apps/web/src/pages/consultas/responder.test.tsx:161-172` — test que fija el «Reintentar» que «solo registra, sin
  reabrir». No cubre que haya ediciones pendientes en el formulario.

## Root Cause Hypothesis

Los dos reintentos comparten la misma forma: **el reintento no es «reaplicar lo que el usuario quiere guardar» sino
«repetir la última escritura conocida con la foto congelada del registro»**, y el estado local del formulario (lo
que la persona acaba de cambiar) queda fuera del intento, sin aviso ni protección.

- Consultas: `registrarRespuesta(consulta)` y `cambiosAlResponder(consulta, …)` toman `estado`, `responsable_id` y
  `nota_interna` del **prop** `consulta` (la fila leída al abrir el diálogo) y los escriben en la base. El formulario
  mantiene en estado local (`DetalleConsulta.tsx:46-48`) los valores editados; el botón «Reintentar» (línea 131)
  vuelve a invocar `registrar()` con la misma foto. Al tener éxito, `onGuardado` cierra el diálogo (`list.tsx:297-300`) y
  las ediciones pendientes se pierden sin aviso; si además el «Guardar» posterior choca con el `updated_at` viejo
  (`useConsultas.ts:89` no refresca el detalle), el «Recargar» remonta el formulario por la `key` de la línea 40 y las
  vuelve a perder.
- Proveedores: el reintento de «Compra para» se implementa como un segundo envío del mismo formulario, pero
  `persistido.current` (`ProveedorFormDialog.tsx:75`) hace que `enviar()` **omita `actualizar_proveedor`**
  (líneas 112-116): solo se reenvían las tiendas. Los campos que la persona editó después del fallo nunca se
  escriben, y el diálogo se cierra con «Proveedor guardado». A eso se suma que el aviso de ese caso titula
  «No se guardó el proveedor.» cuando el proveedor **sí** se guardó, y no ofrece un «Reintentar» explícito: el
  reintento es implícito y nada advierte que el formulario ya no se re-guardará.

Es decir: la pérdida es silenciosa y no hay corrupción de datos — no se pierde nada de lo ya persistido; lo que
se pierde es trabajo del usuario no guardado, y el sistema lo da por guardado. Confianza: **alta** para Consultas
(el camino está leído completo, con los números de línea citados) y **media-alta** para Proveedores (el mecanismo del
`persistido` es inequívoco, pero falta confirmar con la persona que reportó si ése es el reintento al que se refiere:
ese camino no tiene botón «Reintentar» visible).

## Proposed Remediation

**Preferred**: que el reintento sea una **reaplicación del estado actual del formulario**, no una repetición de la foto
congelada, y que ninguna escritura parcial pise lo que el usuario tiene sin guardar.

1. **Consultas — «Responder por…» y su «Reintentar»** (`DetalleConsulta.tsx`, `lib/responderConsulta.ts`):
   - `registrar()` debe pasar el estado **local** del formulario (o, si el registro de la respuesta es una operación
     aparte, no debe escribir `nota`/`estado` que el usuario tiene editados). Hoy `registrarRespuesta` reescribe
     `nota` con `consulta.nota_interna` y `estado` con el de la foto: lo natural es que el registro de la respuesta
     toque **solo** lo que le corresponde (estado `nueva → en_curso` y responsable si no había) y **no** reescriba la
     nota interna; o que respete la nota que la persona tiene en el formulario.
   - Tras un registro exitoso, el detalle debe quedar con el `updated_at` nuevo (o la `key` no debe remontar el
     formulario al releer) para que el «Guardar» posterior no choque por conflicto. Alternativa: `useConsulta` que se
     suscriba a `revisionConsultas` (como hace `useBandejaConsultas`), o que el `onGuardado` re-lea la consulta.
   - Mientras haya ediciones sin guardar, el diálogo debería avisar antes de cerrarse o de reescribir la fila
     (hay precedente en el repo: `specs/20261022-084830-tienda-dominio-e-identidad/spec.md` FR-009, «descarta cambios
     sin guardar con aviso»).
2. **Proveedores — reintento de «Compra para»** (`ProveedorFormDialog.tsx`):
   - El reintento debe volver a enviar **el formulario completo** cuando el proveedor ya existe y el sello siga
     vigente, en lugar de saltarse `actualizar_proveedor` por el `ref`. Si el objetivo es solo no duplicar el alta,
     el `ref` debería distinguir «alta ya creada» de «edición ya aplicada»: en la edición, el reintento tiene que
     re-guardar los campos (con el `updated_at` vigente) además de las tiendas.
   - El aviso del fallo de «Compra para» debe tener su propio botón («Reintentar» / «Reintentar las tiendas») y un
     título que no contradiga al cuerpo («El proveedor se guardó, pero no pudimos guardar «Compra para».»).
3. **Transversal**: ninguna recarga, reintento o cierre de diálogo debería descartar lo que la persona editó sin
   guardar sin aviso. Si se decide conservar el comportamiento actual, al menos debe haber un aviso explícito
   («se va a recargar y se pierden los cambios sin guardar») en los caminos `Recargar`/`onRecargar`.

**Alternatives**:
- Preservar el borrador: guardar el estado local del formulario en una variable y reinyectarlo tras el remount de la
  `key` (DetalleConsulta.tsx:40) o tras el `onRecargar` de la ficha. Cubre más casos (incluido el «Recargar» por
  conflicto) pero es más invasivo: hay que decidir qué hacer con el borrador cuando el registro cambió de verdad.
- No reescribir la nota al responder (tratar «Responder por…» como un cambio de estado/responsable únicamente) y
  dejar la nota interna exclusively al «Guardar». Es el cambio más chico para Consultas y evita el overwrite; deja
  pendiente decidir qué pasa con el `updated_at` y el conflicto posterior.

**Files likely to change**:
- `apps/web/src/components/consultas/DetalleConsulta.tsx`
- `apps/web/src/lib/responderConsulta.ts`
- `apps/web/src/hooks/useConsultas.ts` (y/o `apps/web/src/pages/consultas/list.tsx`)
- `apps/web/src/components/proveedores/ProveedorFormDialog.tsx`
- `apps/web/src/pages/proveedores/show.tsx` (cambio del estado al ficha, si se decide avisar antes de descartar)
- `apps/web/src/lib/proveedores.ts` (solo si hace falta distinguir alta de edición en el reintento)
- Tests: `apps/web/src/pages/consultas/responder.test.tsx`, `apps/web/src/components/consultas/DetalleConsulta.test.tsx`,
  `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx`
- Docs: `docs/consultas.md`, `docs/proveedores.md` (§ «Compra para» / «Responder desde el panel»)

**Tests to add or update**:
- Consultas: con «Estado»/«Nota interna» editados y **sin guardar**, un «Reintentar» de «Responder por…» no debe
  escribir la nota/estado viejos, y tras el reintento exitoso el formulario no debe perder lo editado.
- Consultas: tras responder, el «Guardar» posterior del formulario no debe fallar por 40001 con un `updated_at` viejo
  (o, si falla, el «Recargar» no debe borrar lo pendiente sin aviso).
- Consultas: el «Recargar» por conflicto no debe montar de nuevo el formulario con los valores del servidor sin
  avisar del descarte (o debe reinyectar el borrador).
- Proveedores: tras el fallo de «Compra para», el reintento debe reenviar **los campos editados** además de las
  tiendas (hoy `ProveedorFormDialog.test.tsx:220-232` solo comprueba que el proveedor no se duplique: hay que
  agregar el caso «se editó la razón social entre el fallo y el reintento»).
- Proveedores: el aviso del fallo de «Compra para» debe tener título coherente con su cuerpo y su propio botón de
  reintento.

## Risks & Considerations

- Cambiar `registrarRespuesta` para no reescribir la nota/estado altera el contrato implícito de
  `public.actualizar_consulta` (MSF-122) y el pgTAP `supabase/tests/database/consultas_responder.test.sql`: hay que
  revisar que el registro de la respuesta siga dejando la consulta «En curso» con responsable.
- Reaplicar el formulario en el reintento de Proveedores vuelve a usar `actualizar_proveedor` con un `updated_at`
  que puede haber quedado viejo (la fila ya se actualizó en el primer intento): sin refrescar el sello, el reintento
  puede dar 40001 y volver a entrar en el camino de «Recargar». Es la parte más delicate del arreglo.
- Mover el reintento de «Compra para» a un botón propio cambia el flujo visible del diálogo: hay que respectar el
  prototipo (`design/pantallas/Proveedores.dc.html` / `Proveedores.inventory.json`) y correr
  `pnpm prototipo:inventario` si el inventario cambia; si el prototipo ya no muestra ese botón, el arreglo debe
  justificarse en `spec.md` (matriz pantalla↔criterios).
- Sin migración de base de datos: el arreglo es de aplicación (web). Si algún día hace falta un estado «borrador»,
  eso ya sería una spec aparte.
- Requisito del repo: `pnpm docs:check` y `pnpm matriz:check` deben pasar (los docs de consultas/proveedores describen
  hoy el comportamiento que se quiere cambiar).
- El grafo de graphify del worktree estaba desactualizado y **no indexaba** estos componentes de `apps/web`
  (`graphify explain "DetalleConsulta"` → «No node matching»). Tras `graphify . --code-only --update` (7895 nodos)
  ya los indexa y confirma los puntos citados: `DetalleConsulta()` en `DetalleConsulta.tsx:36` → `Formulario()` en la
  línea 40 (la `key` que remonta) y `ProveedorFormDialog()` en `ProveedorFormDialog.tsx:49` → `Formulario()` en la
  línea 53. La evidencia de este assessment sale de leer el código y los tests directamente.

## Open Questions

- [NEEDS CLARIFICATION: en Proveedores, ¿el «reintento» del reporte es el segundo «Guardar proveedor» (el único
  reintento posible del fallo de «Compra para») o un botón «Reintentar» de las tiendas que la persona vio en otra
  versión de la pantalla?]
- [NEEDS CLARIFICATION: ¿la organización espera que «Responder por…» guarde también la «Nota interna» y el «Estado»
  que la persona editó en el formulario, o que «Responder por…» solo registre el estado/responsable y deje la nota
  para el «Guardar»? Hoy el código hace lo primero usando la foto vieja.]
- [NEEDS CLARIFICATION: ante un conflicto de edición (40001) que obliga a «Recargar», ¿la organización quiere que se
  preserve el borrador o que se descarte con aviso explícito?]
- [NEEDS CLARIFICATION: ¿el aviso «No se guardó el proveedor.» del fallo de «Compra para» (que contradice su cuerpo)
  entra en este mismo bug o se traza aparte?]
