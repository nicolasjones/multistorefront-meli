# Consultas: bandeja y aviso (MSF-122)

Cada consulta que un visitante envía desde una tienda queda registrada en el panel, el equipo la atiende
desde una bandeja y la empresa recibe un correo de aviso con un enlace a la consulta. Spec:
[`specs/20261023-120000-consultas-bandeja-y-aviso`](../specs/20261023-120000-consultas-bandeja-y-aviso/spec.md)
(contrato en `contracts/consultas.md`).

La bandeja es **solo un registro**: la respuesta al visitante se da fuera del sistema (correo o WhatsApp) y el
panel no envía nada al visitante. El formulario de la tienda, el botón de WhatsApp y el anti-spam son de
Tiendas online (MSF-212).

## Modelo (Principio VII: todo en `dominio`)

| Objeto | Esquema | Para qué |
|---|---|---|
| `dominio.consultas` | `dominio` | Lo que preguntó un visitante a una empresa (entidad de negocio). |
| `dominio.consultas_configuracion` | `dominio` | Dirección de avisos de la empresa (una fila por empresa). |
| `publico.crear_consulta_publica` | `publico` | Único punto de alta de la bandeja; solo `service_role` y la RPC de la tienda (`publico.enviar_consulta_contacto`, que aplica el anti-spam). `anon` y `authenticated` no la ejecutan. |
| `public.consultas_bandeja` (vista `security_invoker`), `actualizar_consulta`, `contar_consultas_nuevas`, `responsables_consultas`, `guardar_correo_avisos_consultas` | `public` | Lectura y ejecución desde el panel; no guardan datos. |
| `dominio.intereses_whatsapp` | `dominio` | Un registro por cada toque en «Consultar por WhatsApp» de un producto (F-CON-02). Sin datos personales. |
| `publico.registrar_interes_whatsapp` | `publico` | Alta del interés; la ejecuta la tienda (`anon`). |
| `public.interes_whatsapp_por_producto` (vista `security_invoker`) | `public` | Lectura agrupada por empresa y producto; no guarda datos. |

## Estados

Tres estados fijos: **Nueva**, **En curso** y **Resuelta** («En curso» es la propuesta de la spec, Decisión
abierta 1). Todo cambio es manual: asignar o anotar no cambia el estado. Se puede volver de cualquiera a
cualquiera (reabrir). Los estados editables son F-CFG-01, fuera de alcance.

## Permisos

- Sección `consultas` (matriz por rol, resuelta por la empresa activa): `edicion` asigna, anota y cambia el
  estado; `lectura` ve la bandeja y el detalle sin cambiar nada; `ninguno` no ve el menú y la ruta muestra
  «Acceso restringido».
- Las filas se ven solo si la empresa es accesible para la persona (`private.empresas_accesibles()`) y es de su
  organización.
- La dirección de avisos se edita en la ficha de la empresa, pestaña **General**, con `empresas`=`edicion`;
  sin ese nivel el campo es de solo lectura y la RPC responde `42501`.
- Cada cambio relevante queda en `registro_actividad` (`consulta.estado_cambiado`, `consulta.asignada`,
  `consulta.nota_actualizada`).

## RPC pública

`publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)`:

- La empresa sale **solo del host** (`dominio.tiendas`, normalizado); no recibe `empresa_id`.
- Host desconocido, inválido o de empresa desactivada → el mismo error `P0002` genérico, resuelto **antes** de
  validar los datos para que no se pueda sondear qué dominios existen.
- Datos inválidos → `22023` con el campo en `DETAIL`: origen ∈ {`formulario`, `whatsapp`}; nombre de 1 a 120;
  contacto correo o teléfono (7 a 15 dígitos), hasta 200; mensaje obligatorio salvo `whatsapp`, hasta 2000;
  `producto_id` de la misma organización.
- Ejecutable por `anon` y `authenticated`. Vive en `publico`, no en `public`, por eso no entra a la lista de
  RPC de `anon` del pgTAP de `docs/acceso-ingreso.md`.
- **Sin anti-spam propio**: el campo trampa y el límite por IP son de la tienda (MSF-212).

## Interés por WhatsApp (F-CON-02, MSF-226)

Cuenta cuántas veces los visitantes tocaron «Consultar por WhatsApp» en cada producto. Spec:
[`specs/20261024-140000-consultas-seguimiento-y-whatsapp`](../specs/20261024-140000-consultas-seguimiento-y-whatsapp/spec.md)
(contrato en `contracts/consultas-seguimiento.md`).

- **Sin datos personales**: `dominio.intereses_whatsapp` guarda solo `organizacion_id`, `empresa_id`, `producto_id` y `created_at`. No hay nombre, teléfono, correo, IP ni mensaje; cada fila es un toque.
- **RPC** `publico.registrar_interes_whatsapp(host, producto_id)`: la empresa sale solo del host (`dominio.tiendas`); host desconocido o empresa desactivada → el mismo `P0002` genérico, resuelto antes de validar el producto; producto nulo, inexistente o de otra organización → `22023` con `producto_id` en `DETAIL`. Ejecutable por `anon` y `authenticated`. Sin anti-spam propio (es de la tienda, F-TDA-14 / MSF-212).
- **Vista** `public.interes_whatsapp_por_producto` (`security_invoker`): `organizacion_id`, `empresa_id`, `empresa_nombre`, `producto_id`, `producto_nombre`, `sku`, `total`, `ultimo_interes_at`. Aplica la RLS de la tabla; `anon` sin acceso. Es el contrato de lectura para F-REP-04 (productos más consultados).
- **Permisos**: se ve con `consultas` ≥ `lectura` y empresa accesible; nadie inserta, edita ni borra desde la app (sin políticas de escritura). En el panel, el botón `Interés por WhatsApp` de Consultas abre un diálogo (`InteresWhatsappDialog`) con `Producto`, `Tienda` (solo en «Todas mis empresas»), `Veces` y `Último interés`, ordenado de mayor a menor; al cambiar de empresa se recarga y el diálogo abierto se cierra con aviso (Principio VIII).
- **Contrato para F-TDA-14**: la tienda llama a la RPC con su host y el `producto_id` al tocar el botón; no manda empresa ni organización.
- **Pruebas**: pgTAP `supabase/tests/database/interes_whatsapp.test.sql`, Vitest `pages/consultas/InteresWhatsappDialog.test.tsx` y E2E de la RPC.
- **Reversión**: migraciones aditivas `20261214100000`…`20261214100200`; en una migración posterior, de la más nueva a la más vieja: `drop view public.interes_whatsapp_por_producto`, `drop function publico.registrar_interes_whatsapp(text, uuid)` y `drop table dominio.intereses_whatsapp` (exportar antes los datos).

## Responder desde el panel (F-CON-04, MSF-244)

El botón `Responder por <correo|WhatsApp>` del detalle **no envía nada**: abre el cliente externo y registra en la base que la consulta quedó atendida.

- **Canal** por el formato del contacto (`apps/web/src/lib/responderConsulta.ts`, `enlaceRespuesta`): correo → `mailto:<correo codificado>?subject=…&body=…`; teléfono → `https://wa.me/<dígitos internacionales>?text=…` (misma `normalizarNumero` que la ficha, MSF-696: un teléfono local argentino lleva `549`; sin código de área o ambiguo no ofrece enlace). Todo valor va codificado y el enlace se abre en pestaña nueva (`noopener,noreferrer`) en el mismo gesto del clic.
- **Texto inicial**: `armarTextoInicial` (`apps/web/src/lib/textoInicialConsulta.ts`) con una plantilla fija (nombre, tienda y producto si lo hay). Es el único punto que reemplaza F-CON-06: con una respuesta rápida elegida, el cuerpo es su texto con las variables resueltas (ver «Respuestas rápidas»).
- **Registro**: llama a `public.actualizar_consulta` (MSF-122, sin migración nueva): `nueva` pasa a `en_curso` (`en_curso` y `resuelta` conservan el estado; no se reabre), el responsable es quien responde **solo si no había**, y se mandan la nota y el `updated_at` vigentes. La actividad la registra la propia RPC.
- **Lo que está en el formulario** (MSF-698): el registro manda el estado, el responsable y la nota **que la persona tiene en el formulario en ese momento**, no la foto leída al abrir el detalle: responder no descarta lo recién editado ni vuelve a escribir la nota vieja. El «Reintentar» del aviso manda lo mismo.
- **Sello vigente** (MSF-698): el detalle se relee cuando cambia una consulta, así que su `updated_at` no queda viejo y la acción siguiente no choca con el control de concurrencia (lo que obligaba a recargar y a perder lo pendiente).
- **Permisos**: con `consultas` = edición responde y registra; con lectura el botón queda deshabilitado («Necesitás permiso de edición»). La base lo impone (`actualizar_consulta` exige edición).
- **Fallos**: si el registro falla (`40001`, `42501`, red) la app externa ya se abrió; el detalle muestra el error con `Reintentar` (solo registra, no reabre la app) o `Recargar` ante un conflicto. Un reintento tras éxito es idempotente.
- **Aviso de éxito**: dice cómo quedó la consulta («Consulta En curso a tu nombre»), nunca que el mensaje salió.
- **Pruebas**: Vitest `apps/web/src/pages/consultas/responder.test.tsx`, pgTAP `supabase/tests/database/consultas_responder.test.sql`, E2E `apps/web/e2e/consultas-responder.e2e.ts`.
- **Reversión**: sin migración ni datos nuevos; basta revertir el merge de la historia.

## Respuestas rápidas (F-CON-06, MSF-274)

Textos frecuentes **por empresa** que arman el texto inicial de `Responder por…`. Siguen sin enviar nada.

- **Modelo** (migraciones `20270201200000` y `20270201200100`): `dominio.respuestas_rapidas` (esquema `dominio`: contenido de negocio sin datos personales; `titulo` ≤ 80, `texto` ≤ 1000, FK compuesta a `dominio.empresas`, `unique (id, organizacion_id)`). La vista `public.respuestas_rapidas_lista` es `security_invoker`; `guardar_respuesta_rapida(p_id, p_empresa_id, p_titulo, p_texto)` y `eliminar_respuesta_rapida(p_id)` son `security definer`, exigen `consultas` = edición y empresa accesible, y devuelven `42501` igual para lo inexistente, ajeno o sin acceso, y `22023` ante título o texto inválidos. Al editar no se mueve la empresa.
- **Permisos y RLS**: select con `consultas` ≥ `lectura` + organización + empresa accesible; sin políticas de escritura; `revoke all … from public, anon, authenticated` + `grant select`; RPC con `revoke … from public, anon` + `grant … to authenticated`; `anon` sin privilegios.
- **Actividad**: `respuesta_rapida.creada|editada|eliminada` con el título y la empresa, nunca el texto.
- **Variables** (`resolverVariables`, `apps/web/src/lib/respuestasRapidas.ts`): `{nombre}`, `{tienda}`, `{producto}`. Una sola pasada (el valor no se vuelve a expandir); sin valor queda vacía, sin llaves, sin espacios dobles ni espacio antes de la puntuación; una variable desconocida queda tal cual.
- **UI**: botón `Respuestas rápidas` en el encabezado de Consultas (`RespuestasRapidasDialog`): lista de la empresa activa, crear, editar y eliminar (con confirmación), ayuda de variables y estados compartidos. Con `lectura` se ve sin cambiar; con «todas las empresas» pide elegir una tienda. En el detalle, `Respuesta rápida` ofrece solo las de la empresa de la consulta; sin elección queda la plantilla de F-CON-04.
- **Empresa activa (Principio VIII)**: al cambiar la empresa se cierra el diálogo con aviso y el hook descarta lo cargado (ámbito organización + empresa); el selector del detalle lee por la empresa de la consulta.
- **Pruebas**: pgTAP `supabase/tests/database/respuestas_rapidas.test.sql`; Vitest `lib/respuestasRapidas.test.ts`, `pages/consultas/RespuestasRapidasDialog.test.tsx`, `responder.test.tsx` y `list.test.tsx`; E2E `apps/web/e2e/consultas-respuestas-rapidas.e2e.ts`.
- **Reversión** (migración posterior, exportando antes los textos): `drop view public.respuestas_rapidas_lista`, `drop function public.guardar_respuesta_rapida(uuid, uuid, text, text)` y `public.eliminar_respuesta_rapida(uuid)`, y `drop table dominio.respuestas_rapidas`. Para deshacer la historia en Git: `git revert -m 1 <merge del PR>`.

## Aviso por correo

> **MSF-853 (gate)**: el camino directo del aviso (la Edge Function `enviar-aviso-consulta`, el flow de
> Kestra `avisos-consultas`, la tabla `dominio.consultas_avisos` y sus tres RPC) se eliminó: desde
> MSF-562 el alta ya no encolaba ahí y la revisión de los E2E confirmó que no sale correo SMTP de «nueva
> consulta» por esa vía. El aviso vigente es el de plataforma (abajo) y la dirección de avisos por empresa
> (`consultas_configuracion`) ya no alimenta ningún aviso: la ficha de la empresa lo advierte.

El aviso de consulta nueva sale por la cola de plataforma ([`avisos-por-correo.md`](./avisos-por-correo.md)):

1. El alta de la consulta dispara `consultas_encolar_aviso` sobre `dominio.consultas`, que llama a
   `private.encolar_aviso_consulta()` y emite con `private.emitir_aviso('consulta_nueva', …, empresa)`.
2. Se encola en `public.avisos_pendientes` para cada persona de la organización con acceso a la sección
   `consultas` y a la empresa de la consulta, respetando la preferencia de cada una («Avisos por correo»)
   y agrupando en una ventana de 15 minutos. Un fallo al emitir se registra (`RAISE WARNING`) y no frena
   el alta.
3. El flow de Kestra `enviar-avisos` reclama los grupos vencidos y manda un correo por grupo (texto
   escapado, sin enlace: el equipo entra al panel).

Reversión (migración posterior): recrear la tabla y las tres RPC con el cuerpo de `20261205200100` y
`20261205200200`, `private.correo_avisos_consulta` con el de `20261205200000`, volver a excluir la tabla
en `private.exclusiones_exportacion_total()` y reponer la Edge Function y el flow (Git:
`git revert -m 1 <merge del PR>`).

## Variables

| Variable | Dónde | Para qué |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `supabase/functions/.env.example` (secretos de la función) | Proveedor de correo transaccional; el mismo que `solicitar-acceso` (Mailpit en local). Qué proveedor y dominio (SPF/DKIM) es la Decisión abierta 3, sin definir. |
| `PANEL_URL` | `supabase/functions/.env.example` | Base pública del panel para los enlaces de los correos de avisos. |

El aviso de consulta nueva ya no usa SMTP propio: lo manda el flow `enviar-avisos` de Kestra con
`KESTRA_SMTP_*` (`infra/kestra/.env.example`), igual que el resto de los avisos por correo.

No se guarda ningún secreto en Git y la service-role key nunca llega al navegador.

## Revisión de seguridad (FR-015)

Hecha sobre las migraciones `20261205100000`…`20261205200200` y `20270305140001` (MSF-853):

- **RLS en las 2 tablas**: `enable row level security` y política `select` por organización, empresa
  accesible y nivel de sección; sin políticas de escritura (alta solo por la RPC pública, cambios solo por RPC
  `security definer`). `revoke all … from public, anon, authenticated` y `grant select` solo a `authenticated`.
  La prueba `rls_en_toda_tabla` recorre `public` + `dominio`.
- **`anon`** no ejecuta `publico.crear_consulta_publica` (migración `20261212100100`: saltearía el límite de 5 por hora); la tienda entra por `publico.enviar_consulta_contacto`; las RPC del panel llevan
  `revoke … from public, anon` + `grant … to authenticated`; las funciones de
  `private` no se exponen.
- **Validación de entrada** en el servidor (largos, formato de contacto, origen, producto de la misma
  organización); el texto del visitante se muestra como texto plano en el panel (React lo escapa).
- **Sin enumeración de dominios**: mismo `P0002` para host desconocido y empresa desactivada, resuelto antes de
  validar datos.
- **El aviso sale por la cola de plataforma**: `private.emitir_aviso` es `security definer` con
  `search_path = ''` y solo lo llaman funciones internas; el destino lo decide la base (preferencia, sección y
  acceso a la empresa), nunca el pedido. Ver [`avisos-por-correo.md`](./avisos-por-correo.md).
- **Interés por WhatsApp (MSF-130, FR-015)**: `dominio.intereses_whatsapp` con RLS por organización, empresa accesible y `consultas` ≥ `lectura`, sin políticas de escritura y con `revoke all … from public, anon, authenticated` + `grant select` a `authenticated`; la vista es `security_invoker` y `anon` no la lee; `anon` solo ejecuta `publico.registrar_interes_whatsapp` (`search_path = ''`, empresa solo por dominio, mismo `P0002` para dominio desconocido y empresa desactivada); no guarda datos personales. Esquemas: tabla en `dominio`, RPC en `publico`, vista en `public` (sin datos). Los enlaces de `Responder por` van codificados (`encodeURIComponent`, `wa.me` solo con dígitos). Comprobado por pgTAP (`interes_whatsapp.test.sql`, `consultas_responder.test.sql`, `rls_en_toda_tabla`).
- **Esquemas contra el Principio VII**: las dos tablas son entidades de negocio y viven en `dominio`; ninguna
  tabla en `public`.
- **Riesgos aceptados**: (1) la RPC pública no tiene límite de frecuencia: el anti-spam es de MSF-212 y mientras
  no exista un tercero puede llenar la bandeja de una tienda; (2) entrega «al menos una vez» (posible
  duplicado); (3) los datos personales del visitante no tienen política de retención (abajo).

## Retención pendiente

No hay política definida para las consultas ni para los datos personales que traen (Decisión abierta 5). Esta
entrega **no borra ni expira nada**. Cuando se defina, será una spec aparte.

## Reversión

Las migraciones son aditivas o llevan su camino de reversión en el encabezado; la reversión va en una
migración posterior, de las más nuevas a las más viejas:

1. Aviso (MSF-853): recrear `dominio.consultas_avisos`, las tres RPC `public.avisos_consulta_pendientes`,
   `tomar_aviso_consulta` y `cerrar_aviso_consulta`, y `private.correo_avisos_consulta`; volver a excluir la
   tabla en `private.exclusiones_exportacion_total()`; reponer la Edge Function `enviar-aviso-consulta` y el flow
   de Kestra `avisos-consultas`.
2. Dirección de avisos: `drop function public.guardar_correo_avisos_consultas` y
   `private.correo_avisos_consulta`, y `drop table dominio.consultas_configuracion`.
3. Bandeja: `drop view public.consultas_bandeja`, `drop function` de `contar_consultas_nuevas`,
   `responsables_consultas`, `actualizar_consulta`, `private.responsables_posibles` y los auxiliares de
   nombres, `drop function publico.crear_consulta_publica(text, text, text, text, text, uuid)` y, al final,
   `drop table dominio.consultas` (borra las consultas registradas: exportar antes si importan).

Para deshacer el cierre completo en Git: `git revert -m 1 <merge del PR>`.

## Verificación

- pgTAP: `supabase/tests/database/consultas.test.sql`, `consultas_aviso.test.sql` (dirección de avisos y el
  gate de MSF-853: el camino directo ya no existe), `avisos_consulta_nueva.test.sql` (el aviso vigente sale por
  `private.emitir_aviso`), `interes_whatsapp.test.sql`, `consultas_responder.test.sql` y `rls_en_toda_tabla`.
- Vitest: `pages/consultas`, `components/consultas`, `pages/empresas/CorreoAvisosConsultas.test.tsx`.
- E2E de cierre (SC-004, SC-008): `apps/web/e2e/consultas-recorrido.e2e.ts`. Con `pnpm dev:supabase` y la web
  servida:

  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    pnpm --filter @platform/web test:e2e consultas-recorrido
  ```

  Envía una consulta como `anon`, mide que la bandeja la muestra en menos de 5 s, comprueba que el aviso
  quedó encolado para la persona de la organización (`public.avisos_pendientes`), abre el detalle, asigna,
  anota y resuelve como Administrador, comprueba Lectura (solo ver) y
  Mostrador (Acceso restringido), y que otra organización no la ve. Siembra y limpia con la API admin y se omite
  sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, y aborta si `SUPABASE_URL` no es un host local (crea usuarios con
  contraseña conocida). La limpieza borra la organización y el `on delete cascade` arrastra empresas, tiendas,
  consultas y configuración.

## Bandeja con carga infinita e imagen del producto

La bandeja de consultas carga por tandas de 25 desde `consultas_bandeja` al llegar al final del scroll («Cargar más» para teclado), sin paginación numerada. Buscar, cambiar estado, fechas, tienda o guardar una consulta reinicia desde la primera tanda; el contador total se mantiene. La columna «Producto» muestra la imagen principal como miniatura con zoom cuando la consulta tiene `producto_id`, y lo mismo el diálogo «Interés por WhatsApp». Ver [`listados.md`](./listados.md).
