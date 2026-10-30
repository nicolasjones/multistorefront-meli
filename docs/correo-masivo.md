# Correo masivo a clientes (MSF-155)

Spec: `specs/20261028-100000-correo-masivo-a-clientes/`. Esta guía crece con cada historia de la épica; hoy cubre
**F-CLI-11 · Destinatarios** (MSF-357) y **F-CLI-12 · Redactar y enviar con baja** (MSF-370) y
**F-CLI-13 · Historial de campañas** (MSF-376).

## Aceptación del cliente

- Columna `public.clientes.acepta_correo_masivo` (`boolean not null default false`). Los clientes existentes quedan
  **sin aceptación** hasta que se los marque (no hay consentimiento previo).
- Se cambia con el interruptor **«Incluir en el correo masivo»**:
  - en el formulario de alta y edición (`FormularioCliente`); en el **alta nace encendido**, como el prototipo;
  - en el bloque **«Comunicaciones»** de la ficha (`/clientes/show/:id`), que guarda al instante y queda de solo
    lectura para quien no edita Clientes.
- El alta rápida del taller (Service técnico) **no** pide el consentimiento: esos clientes nacen sin aceptación.
- La columna entra en los grants por columna de `authenticated` (insert/update); la RLS de `clientes` no cambia.

## Quién es destinatario

Un cliente es **elegible** si está activo (no archivado), tiene `acepta_correo_masivo` y un correo válido
(una sola dirección: se rechazan `,` y `;`). El Consumidor final del mostrador nunca es destinatario.

El resumen reparte a los clientes activos que cumplen los filtros en tres grupos que suman el total:

| Grupo | Criterio |
|---|---|
| `elegibles` | con correo válido y con aceptación |
| `sin_correo` | sin correo válido (acepte o no) |
| `no_aceptan` | con correo válido pero sin aceptación |

## Filtros (los mismos del listado de Clientes)

Búsqueda de texto (literal: `%` y `_` no son comodines), tipo (minorista / mayorista), empresa (`FiltroEmpresa`),
«con cuenta web» (cuenta activa y cliente habilitado en la tienda) y, opcionalmente, los clientes marcados en el
listado (`p_clientes`).

## Funciones de base (esquema `public`, `security invoker`)

Migración `20270120100000_clientes_acepta_correo_masivo.sql`. No se crea ninguna tabla.

| Función | Devuelve |
|---|---|
| `listar_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes, p_pagina, p_tamano)` | `{ total, filas: [{ id, numero, nombre, correo }] }` |
| `resumen_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes)` | `{ elegibles, sin_correo, no_aceptan }` |

Ambas **exigen edición en la sección `clientes`** (con lectura rechazan con `42501`; la UI oculta, la base manda),
respetan la RLS por organización y no son ejecutables por `anon`. El filtro común vive en
`private.clientes_para_correo_masivo`.

## Pantallas y rutas

- **Correo masivo → Nueva campaña**: `/clientes/correo-masivo`, entrada «Correo masivo» (ícono de sobre) del menú
  Contactos, para roles con edición en Clientes. Muestra filtros, destinatarios paginados, el conteo y cuántos
  quedan afuera y por qué.
- **Listado de Clientes**: la acción «Enviar correo a seleccionados (N)» abre el diálogo de F-CLI-12 con los N marcados;
  sin selección avisa «Elegí al menos un cliente con las casillas». El diálogo del prototipo es el de F-CLI-12 (ver abajo).

## Empresa activa (Principio VIII)

La pantalla sigue la empresa de la barra superior: al cambiarla recarga lista y resumen, vuelve a la página 1,
descarta la selección que venía del listado y no muestra filas de la empresa anterior.

## Reversión

Migración posterior (nunca en el mismo PR): borrar las dos funciones públicas y `private.clientes_para_correo_masivo`,
y luego `alter table public.clientes drop column acepta_correo_masivo`. El detalle está en el encabezado de la migración.

---

# F-CLI-12 · Redactar y enviar el correo masivo con baja (MSF-370)

## Redacción, vista previa y prueba

- **Nueva campaña** (`/clientes/correo-masivo`) suma, bajo la lista de destinatarios: **Asunto** (obligatorio, ≤ 200,
  sin saltos de línea) y **Mensaje** (obligatorio, ≤ 10 000, texto plano: nunca HTML; React lo escapa y el flow lo
  vuelve a escapar), **Vista previa**, **Enviar prueba** y **Enviar correo** (pide confirmación). Los mismos límites
  están en `lib/correoMasivo.ts` y en la base (`private.validar_redaccion_correo_masivo` y los `check` de las tablas).
- **Vista previa** (`vista-previa.tsx`): el correo final con el pie fijo y un enlace de baja **de ejemplo** (no se abre).
- **Enviar prueba**: `solicitar_prueba_correo_masivo` deja una fila en `dominio.correo_masivo_pruebas` con el correo del
  usuario que redacta; el flow la envía con el prefijo «[Prueba]». No crea campaña ni cuenta contra el cupo. Tope: 5 por
  hora y por persona.
- **Enviar correo**: `crear_campana_correo(p_clave, …)` crea **una** campaña con la foto de los elegibles de ese momento
  (cliente y correo usado) y la clave (uuid generado al abrir la confirmación o el diálogo) hace idempotente el doble
  clic y el reintento tras un error de red. Sin elegibles se rechaza (`22023`, hint `sin_destinatarios`) y no deja
  una campaña vacía. Exige edición en `clientes`. Registra la actividad `campana_correo.crear` (asunto y cantidad; sin
  cuerpo ni correos).
- **Diálogo del listado** (`DialogoCorreoSeleccionados`): textos del prototipo («Enviar correo a seleccionados», «Se envía
  a los N clientes marcados en el listado. Solo reciben el correo quienes tienen un mail cargado y aceptan el correo
  masivo», Asunto, Mensaje, «Cancelar», «Enviar correo»). Crea la campaña solo con los marcados y la empresa activa. El
  texto agrega «y aceptan el correo masivo» a lo que dibuja el prototipo: manda el requisito (regla 6 de la spec).
- **Después de enviar** la pantalla confirma «Campaña creada» y se limpia. El paso al historial lo trae F-CLI-13
  (la pestaña todavía no existe en este PR).

## Empresa activa (Principio VIII)

Una confirmación de envío abierta en la pantalla y el diálogo abierto en el listado **se cierran** al cambiar la empresa
de la barra superior (el diálogo avisa «Cambiaste de empresa: se cerró el envío de correo y se descartó la selección»):
nunca se crea una campaña con datos de la empresa anterior.

## Datos (migraciones `20270121110000`, `…110100` y `…110200`)

| Objeto | Esquema | Justificación |
|---|---|---|
| `dominio.campanas_correo` | `dominio` | Hecho del negocio del producto: una campaña, su asunto y mensaje. |
| `dominio.campana_correo_destinatarios` | `dominio` | Foto de destinatarios y estado de envío de cada uno (`pendiente`, `enviado`, `fallido`, `omitido`). |
| `dominio.correo_masivo_pruebas` | `dominio` | Pedidos de prueba al autor; no son campaña. Sin acceso desde la API. |

RLS por organización y sección `clientes` (lectura o edición para ver). `authenticated` no escribe ninguna: todo pasa
por RPC. El **hash de cada enlace de baja** (`token_hashes`) y el vencimiento del reclamo quedan fuera del `grant
select` por columna: PostgREST no los expone. El token en claro nunca se guarda.

## Envío por lotes con cupo diario (flow `correo-masivo`)

`infra/kestra/flows/correo-masivo.yml` corre cada minuto y llama a `private.reclamar_lote_correo_masivo(lote, cupo, 900)`:

1. Las **pruebas** salen primero y no cuentan contra el cupo.
2. **Re-verifica** a cada destinatario pendiente (FR-020): si el cliente se archivó, ya no acepta o no tiene un correo
   válido, queda `omitido`; si cambió de correo, se usa el vigente.
3. **Cupo diario por organización** (`CORREO_MASIVO_LIMITE_DIARIO`, 500 por defecto): se descuenta lo enviado desde las
   00:00 (hora de la base) y lo reclamado sin vencer. Lo que no entra queda `pendiente` y retoma al día siguiente, en el
   orden de la campaña, sin repetir ni perder destinatarios. El lote es de `CORREO_MASIVO_LOTE` (50).
4. **Reclamo con vencimiento** (15 minutos) y un **enlace de baja nuevo por destinatario**; solo se guarda su hash. Un
   reclamo que venció se vuelve a tomar con otro enlace y el del primer correo, si salió, sigue valiendo (los hashes se
   acumulan).

Cada correo sale por el **SMTP de Kestra** (`KESTRA_SMTP_*`, el mismo de `enviar-avisos`; sin proveedor nuevo) con un pie
fijo y no editable: «Recibís este correo porque aceptaste recibir novedades. Si no querés recibirlo más, date de baja
acá» (enlace `<CORREO_MASIVO_URL_BAJA>/baja-correo/<token>`). Un fallo se reintenta 4 veces con espera creciente (30 s,
60 s, 2 min) y, si persiste, el destinatario queda `fallido` con el motivo fijo «No se pudo enviar el correo» (nunca el
detalle del SMTP). Solo un fallo del envío lo marca `fallido`: el cierre como `enviado` se reintenta 3 veces y, si
falla igual, no lo pisa a `fallido` aunque el correo ya haya salido. `private.cerrar_envio_correo_masivo` es idempotente: un `enviado` no pasa a `fallido`. La entrega es
«al menos una vez»: si Kestra se corta entre enviar y cerrar, el correo puede salir dos veces.

Variables (`infra/kestra/.env.example`): `CORREO_MASIVO_LOTE`, `CORREO_MASIVO_LIMITE_DIARIO`, `CORREO_MASIVO_URL_BAJA`.
Las dos funciones `private.*` solo las ejecuta `kestra_orquestacion`.

## Baja

- El enlace abre la página pública **`/baja-correo/:token`** (`pages/baja-correo.tsx`, fuera del panel autenticado). La baja
  se **confirma con un botón**: un visor de enlaces del correo no debe dar de baja a nadie solo por abrirlo.
- La página llama a la Edge Function anónima **`baja-correo-masivo`** (`{ token }`), que calcula el SHA-256 del token y
  llama a `public.dar_de_baja_correo_masivo(hash)` con la service-role (solo ahí). Responde **siempre** `{ ok: true }`,
  exista o no el token y se repita o no la baja: no enumera tokens. Un token con forma inválida responde 400; un fallo
  de la base, 500 sin detalle.
- `dar_de_baja_correo_masivo` apaga `clientes.acepta_correo_masivo`, pasa a `omitido` los pendientes del cliente en
  campañas en curso (SC-004) y registra `campana_correo.baja` (sin correo ni nombre) solo la primera vez.
- Vive en `public` y solo la ejecuta `service_role` (el contrato original la ubicaba en `private`, pero supabase-js solo
  llama RPC de esquemas expuestos); `anon` y `authenticated` no la ejecutan.

## Reversión

Migraciones posteriores (nunca en este PR): `drop function public.dar_de_baja_correo_masivo(text)`,
`private.cerrar_envio_correo_masivo`, `private.reclamar_lote_correo_masivo`, `public.solicitar_prueba_correo_masivo`,
`public.crear_campana_correo`, `private.validar_redaccion_correo_masivo` y luego `drop table` de
`dominio.correo_masivo_pruebas`, `dominio.campana_correo_destinatarios` y `dominio.campanas_correo` (exportar antes el
historial si hace falta). Retirar el flow `correo-masivo` y la Edge Function `baja-correo-masivo` es independiente.

## Pruebas

pgTAP `correo_masivo_campanas.test.sql` y `correo_masivo_lote.test.sql` (`pnpm test:db`); `pnpm test:kestra:correo-masivo`;
`pnpm test:edge:baja-correo-masivo`; Vitest `nueva.test.tsx`, `vista-previa.test.tsx`, `empresa-activa.test.tsx`,
`DialogoCorreoSeleccionados.test.tsx`, `list.correo-masivo.test.tsx`, `baja-correo.test.tsx` y `lib/correoMasivo.test.ts`.

---

# F-CLI-13 · Historial de campañas de correo (MSF-376)

Solo lectura: no se edita, borra ni reenvía nada. Migración `20270121110300_campanas_correo_historial.sql`.

## Pantallas y rutas

- **Correo masivo → Historial**: `/clientes/correo-masivo/historial` (pestaña junto a «Nueva campaña»; esa pestaña
  solo se ofrece con edición en Clientes). Lista paginada (25) de la más reciente a la más antigua con fecha, asunto,
  quién la envió, estado y totales (destinatarios, enviados, fallidos, omitidos, bajas). Se actualiza al recargar.
- **Detalle**: `/clientes/correo-masivo/historial/:id`. Asunto y mensaje enviados (texto plano) y cada destinatario con
  cliente, correo usado, estado, marca de baja y error corto.
- Tras «Enviar correo» el aviso de éxito ofrece «Ver el historial».

## Estado y totales

La campaña está **en curso** mientras algún destinatario siga `pendiente` y **completada** cuando ninguno lo está.
`enviados + fallidos + omitidos + pendientes = destinatarios` (SC-005). Una campaña en curso muestra «N de M procesados».

## Bajas por campaña

`dominio.campana_correo_destinatarios.baja_en` (columna nueva, aditiva) se completa cuando el cliente usa el enlace de
baja **de esa campaña**; `dar_de_baja_correo_masivo` la atribuye (idempotente). Las bajas anteriores a esta migración no
tienen campaña atribuida y no se cuentan.

## Funciones de base (esquema `public`)

| Función | Devuelve |
|---|---|
| `listar_campanas_correo(p_empresa, p_pagina, p_tamano)` | `{ total, filas: [{ id, creada_en, asunto, autor, estado, destinatarios, enviados, fallidos, omitidos, pendientes, bajas }] }` |
| `detalle_campana_correo(p_campana, p_pagina, p_tamano)` | `{ campana: { …totales, mensaje, empresa_id }, total, destinatarios: [{ cliente_id, nombre, correo, estado, error, baja }] }` |

Exigen acceso `lectura` o `edicion` a `clientes` (`42501` si no); `anon` no ejecuta. Son `security definer` solo para leer
el nombre del autor (`perfiles_usuario` es self-only); la organización sale de la sesión y nunca se devuelven los hashes
de baja. Una campaña de otra organización responde `P0002`. El tamaño de página se acota a 100.

## Empresa activa (Principio VIII)

El historial muestra solo las campañas armadas con la empresa activa (las armadas para «todas» aparecen con «Todas las
tiendas»). Al cambiarla recarga, vuelve a la página 1 y no deja filas ni totales de la anterior. El detalle abierto
vuelve al historial al cambiar la empresa y no muestra una campaña de otra tienda.

## Reversión

Migración posterior: `drop function public.detalle_campana_correo(uuid, integer, integer)`, `drop function
public.listar_campanas_correo(uuid, integer, integer)`, restaurar `dar_de_baja_correo_masivo` de `20270121110200` y
`alter table dominio.campana_correo_destinatarios drop column baja_en`.

# Cierre · Revisión de seguridad (T041)

Revisión de `authz-security` y `crypto-secrets` sobre las migraciones `20270120100000` y `20270121110000…110300`, la Edge Function `baja-correo-masivo` y el flow `correo-masivo`. Sin hallazgos críticos ni altos.

- RLS en las tres tablas nuevas; la organización sale siempre de la sesión (`private.organizacion_id()`), nunca de un parámetro.
- `anon` sin ejecución de ninguna RPC del correo masivo y sin privilegios sobre las tablas; `dar_de_baja_correo_masivo` solo para `service_role`.
- Token de baja de unos 244 bits aleatorios; la base guarda solo su SHA-256 y `token_hashes` queda fuera del `grant select` por columna.
- La service-role vive solo en la Edge Function (servidor); el mensaje se escapa en el correo y el asunto no admite saltos de línea.
- Riesgos bajos aceptados: la Edge Function anónima no tiene límite de frecuencia propio (conviene ponerlo en el borde) y el token viaja en la ruta `/baja-correo/:token`, mitigado porque la baja exige confirmar con un POST.
