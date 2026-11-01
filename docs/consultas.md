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
| `dominio.consultas_avisos` | `dominio` | Cola y registro de los avisos por correo (estado, intentos, error útil). |
| `publico.crear_consulta_publica` | `publico` | Único punto de alta de la bandeja; solo `service_role` y la RPC de la tienda (`publico.enviar_consulta_contacto`, que aplica el anti-spam). `anon` y `authenticated` no la ejecutan. |
| `public.consultas_bandeja` (vista `security_invoker`), `actualizar_consulta`, `contar_consultas_nuevas`, `responsables_consultas`, `guardar_correo_avisos_consultas` | `public` | Lectura y ejecución desde el panel; no guardan datos. |
| `public.avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta` | `public` | Solo `service_role`: las usa la función de aviso. |
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
- La lectura de `consultas_avisos` exige `empresas`=`edicion`.
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
- **Texto inicial**: `armarTextoInicial` (`apps/web/src/lib/textoInicialConsulta.ts`) con una plantilla fija (nombre, tienda y producto si lo hay). Es el único punto que reemplazará F-CON-06 (MSF-144).
- **Registro**: llama a `public.actualizar_consulta` (MSF-122, sin migración nueva): `nueva` pasa a `en_curso` (`en_curso` y `resuelta` conservan el estado; no se reabre), el responsable es quien responde **solo si no había**, y se mandan la nota y el `updated_at` vigentes. La actividad la registra la propia RPC.
- **Permisos**: con `consultas` = edición responde y registra; con lectura el botón queda deshabilitado («Necesitás permiso de edición»). La base lo impone (`actualizar_consulta` exige edición).
- **Fallos**: si el registro falla (`40001`, `42501`, red) la app externa ya se abrió; el detalle muestra el error con `Reintentar` (solo registra, no reabre la app) o `Recargar` ante un conflicto. Un reintento tras éxito es idempotente.
- **Aviso de éxito**: dice cómo quedó la consulta («Consulta En curso a tu nombre»), nunca que el mensaje salió.
- **Pruebas**: Vitest `apps/web/src/pages/consultas/responder.test.tsx`, pgTAP `supabase/tests/database/consultas_responder.test.sql`, E2E `apps/web/e2e/consultas-responder.e2e.ts`.
- **Reversión**: sin migración ni datos nuevos; basta revertir el merge de la historia.

## Aviso por correo

> **Desde MSF-562 (épica MSF-189, FR-012)** el alta ya no encola en `consultas_avisos` ni se envía directo:
> el disparador `consultas_encolar_aviso` llama a `private.emitir_aviso('consulta_nueva', …, empresa)` y el flow
> `enviar-avisos` manda el correo respetando las preferencias de cada persona, la agrupación de 15 minutos y
> el acceso a la empresa de la consulta (`docs/avisos-por-correo.md`). Un fallo al emitir se registra
> (`RAISE WARNING`) y no frena el alta. Los pasos de abajo describen el camino anterior, que solo termina de
> enviar lo que ya estaba encolado; la dirección de avisos por empresa (`consultas_configuracion`) no se usa en
> el camino nuevo y la ficha de la empresa lo advierte. Reversión: recrear `private.encolar_aviso_consulta()`
> con el cuerpo de `20261205200100_consultas_avisos.sql` y `private.emitir_aviso(text, uuid, jsonb)` con el de
> `20261210120400_avisos_agrupacion.sql`.

1. El alta encola un aviso en `consultas_avisos` (un disparador `AFTER INSERT`, una vez por consulta, en la
   misma transacción). El repo prohíbe disparar HTTP desde triggers SQL (`docs/adoptar-ciclo-ejecuciones.md`
   §3.1), así que el disparo es un **barrido**.
2. El flow de Kestra `infra/kestra/flows/avisos-consultas.yml` llama cada minuto a la Edge Function
   `enviar-aviso-consulta` con `{"barrer": true}` y el secreto compartido en `x-aviso-token`.
3. La función toma cada aviso pendiente, resuelve el destinatario **en la base** (nunca viene del pedido, así no
   es un relay abierto), manda un correo de **texto plano** con asunto «Nueva consulta · <empresa>» y lo cierra.
4. El correo lleva el enlace `<PANEL_URL>/consultas?consulta=<id>`; el enlace solo tiene el id, ningún dato
   personal.

Destinatario efectivo: la dirección de avisos si la empresa la cargó; si no, el correo de contacto de la
empresa (`dominio.empresas.correo`). Sin ninguno el aviso queda `sin_destinatario` (la consulta sí se registra) y
el barrido lo retoma cuando la empresa cargue un correo.

Estados del aviso: `pendiente` → `enviado` | `fallido` (reintento con tope de 5 intentos y 2 minutos de espera) |
`sin_destinatario`. Un fallo guarda `ultimo_error` y **nunca** afecta a la consulta. Un `pendiente` con el tope
cumplido cuyo proceso murió se cierra como `fallido` con error útil. Garantía: **al menos una vez**; si el correo
salió pero la base no pudo cerrar el aviso, el reintento puede mandar un duplicado (se prefiere eso a perderlo).
Un aviso ya `enviado` no se reenvía.

## Variables

| Variable | Dónde | Para qué |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `supabase/functions/.env.example` (secretos de la función) | Proveedor de correo transaccional; el mismo que `solicitar-acceso` (Mailpit en local). Qué proveedor y dominio (SPF/DKIM) es la Decisión abierta 3, sin definir. |
| `PANEL_URL` | `supabase/functions/.env.example` y `.env.example` | Base pública del panel para el enlace del correo. |
| `AVISOS_CONSULTAS_TOKEN` | `supabase/functions/.env.example` | Secreto compartido con Kestra; sin él la función rechaza todo. |
| `SECRET_AVISOS_CONSULTAS_TOKEN` (base64) y URL/clave del barrido | `infra/kestra/.env.example` | El flow de Kestra lo envía en `x-aviso-token`. Solo en el `.env` de Kestra, nunca en Git. |

No se guarda ningún secreto en Git y la service-role key nunca llega al navegador.

## Revisión de seguridad (FR-015)

Hecha sobre las migraciones `20261205100000`…`20261205200200`, la función y el flow:

- **RLS en las 3 tablas**: `enable row level security` y política `select` por organización, empresa
  accesible y nivel de sección; sin políticas de escritura (alta solo por la RPC pública, cambios solo por RPC
  `security definer`). `revoke all … from public, anon, authenticated` y `grant select` solo a `authenticated`.
  La prueba `rls_en_toda_tabla` recorre `public` + `dominio`.
- **`anon`** no ejecuta `publico.crear_consulta_publica` (migración `20261212100100`: saltearía el límite de 5 por hora); la tienda entra por `publico.enviar_consulta_contacto`; las RPC del panel llevan
  `revoke … from public, anon` + `grant … to authenticated`; las del aviso, solo `service_role`; las funciones de
  `private` no se exponen.
- **Validación de entrada** en el servidor (largos, formato de contacto, origen, producto de la misma
  organización); el texto del visitante se muestra como texto plano en el panel (React lo escapa).
- **Sin enumeración de dominios**: mismo `P0002` para host desconocido y empresa desactivada, resuelto antes de
  validar datos.
- **Correo en texto plano** con `lineaSegura` para cabeceras y cuerpo; el destinatario sale de la base y se
  revalida (formato y 254 caracteres) antes de enviar.
- **Interés por WhatsApp (MSF-130, FR-015)**: `dominio.intereses_whatsapp` con RLS por organización, empresa accesible y `consultas` ≥ `lectura`, sin políticas de escritura y con `revoke all … from public, anon, authenticated` + `grant select` a `authenticated`; la vista es `security_invoker` y `anon` no la lee; `anon` solo ejecuta `publico.registrar_interes_whatsapp` (`search_path = ''`, empresa solo por dominio, mismo `P0002` para dominio desconocido y empresa desactivada); no guarda datos personales. Esquemas: tabla en `dominio`, RPC en `publico`, vista en `public` (sin datos). Los enlaces de `Responder por` van codificados (`encodeURIComponent`, `wa.me` solo con dígitos). Comprobado por pgTAP (`interes_whatsapp.test.sql`, `consultas_responder.test.sql`, `rls_en_toda_tabla`).
- **Esquemas contra el Principio VII**: las tres tablas son entidades de negocio y viven en `dominio`; ninguna
  tabla en `public`.
- **Riesgos aceptados**: (1) la RPC pública no tiene límite de frecuencia: el anti-spam es de MSF-212 y mientras
  no exista un tercero puede llenar la bandeja de una tienda; (2) entrega «al menos una vez» (posible
  duplicado); (3) los datos personales del visitante no tienen política de retención (abajo).

## Retención pendiente

No hay política definida para las consultas ni para los datos personales que traen (Decisión abierta 5). Esta
entrega **no borra ni expira nada**. Cuando se defina, será una spec aparte.

## Reversión

Las migraciones son aditivas; la reversión va en una migración posterior, de las más nuevas a las más viejas:

1. Aviso: `drop trigger consultas_encolar_aviso on dominio.consultas`, `drop function` de
   `public.avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta` y
   `private.encolar_aviso_consulta`, y `drop table dominio.consultas_avisos`. Apagar el flow de Kestra
   `avisos-consultas` y retirar la función `enviar-aviso-consulta`.
2. Dirección de avisos: `drop function public.guardar_correo_avisos_consultas` y
   `private.correo_avisos_consulta`, y `drop table dominio.consultas_configuracion`.
3. Bandeja: `drop view public.consultas_bandeja`, `drop function` de `contar_consultas_nuevas`,
   `responsables_consultas`, `actualizar_consulta`, `private.responsables_posibles` y los auxiliares de
   nombres, `drop function publico.crear_consulta_publica(text, text, text, text, text, uuid)` y, al final,
   `drop table dominio.consultas` (borra las consultas registradas: exportar antes si importan).

Para deshacer el cierre completo en Git: `git revert -m 1 <merge del PR>`.

## Verificación

- pgTAP: `supabase/tests/database/consultas.test.sql`, `consultas_aviso.test.sql`, `interes_whatsapp.test.sql`, `consultas_responder.test.sql` y `rls_en_toda_tabla`.
- Vitest: `pages/consultas`, `components/consultas`, `pages/empresas/CorreoAvisosConsultas.test.tsx`,
  `supabase/functions/enviar-aviso-consulta/handler.test.ts`, `infra/kestra/validar-avisos-consultas.test.mjs`.
- E2E de cierre (SC-004, SC-008): `apps/web/e2e/consultas-recorrido.e2e.ts`. Con `pnpm dev:supabase`, la función
  servida (`supabase functions serve enviar-aviso-consulta --env-file supabase/functions/.env`, con `PANEL_URL`
  igual a la web del E2E) y la web servida:

  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... AVISOS_CONSULTAS_TOKEN=... \
    pnpm --filter @platform/web test:e2e consultas-recorrido
  ```

  Envía una consulta como `anon`, mide que la bandeja la muestra en menos de 5 s, dispara el barrido, lee el
  correo en Mailpit, abre el enlace, asigna, anota y resuelve como Administrador, comprueba Lectura (solo ver) y
  Mostrador (Acceso restringido), y que otra organización no la ve. Siembra y limpia con la API admin y se omite
  sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, y aborta si `SUPABASE_URL` no es un host local (crea usuarios con
  contraseña conocida). La limpieza borra la organización y el `on delete cascade` arrastra empresas, tiendas,
  consultas, avisos y configuración.
