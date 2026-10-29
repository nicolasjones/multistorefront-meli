---
owner: producto
sources:
  - specs
---

# Tienda online · Contacto con formulario (F-TDA-16, MSF-437)

Épica MSF-212, spec [`specs/20261202-100000-tienda-whatsapp-y-contacto`](../specs/20261202-100000-tienda-whatsapp-y-contacto/spec.md).
El visitante abre `/contacto`, ve el WhatsApp (con horarios) y el correo de **su** tienda y envía una consulta que llega a la
bandeja de Consultas y ventas (MSF-122) de esa empresa con origen `formulario`.

## Qué hay

| Capa | Pieza |
|---|---|
| Base (`supabase/migrations/20261212120700_tienda_contacto.sql`) | columna `dominio.empresas.horarios` (≤ 200); tabla `dominio.tienda_envios`; `publico.contacto_por_dominio(host)`; `publico.enviar_consulta_contacto(host, nombre, contacto, mensaje, clave_envio)`; internas `private.visitante_hash`, `limite_envios_tienda`, `registrar_envio_tienda`, `validar_contacto_tienda`, `entregar_a_bandeja` |
| Front público | `apps/web/src/pages/tienda-publica/rutas/contacto.tsx`, `contacto/` (`DatosContacto`, `FormularioContacto`, `validacion.ts`), `lib/tiendaContacto.ts`, `hooks/useContactoTienda.ts`; «Contacto» en el menú (escritorio y celular) y «Escribinos» en el pie |
| Panel | campo «Horarios de atención» en Empresas → General (`pages/empresas/edit.tsx`) |
| Pruebas | pgTAP `supabase/tests/database/tienda_contacto.test.sql`; Vitest en `contacto/*.test.tsx`, `lib/tiendaContacto.test.ts`, `pages/empresas/edit.test.tsx`; E2E `apps/web/e2e/tienda-contacto.e2e.ts` |

## Decisiones y contratos

- **Esquemas (Principio VII)**: `dominio.tienda_envios` y `dominio.empresas.horarios` en **`dominio`**; las funciones públicas en `publico`
  (sin tablas); la lógica interna en `private`. La tabla tiene RLS por organización (solo `select` para `authenticated`) y **ningún**
  privilegio para `anon`; escribe solo `private.registrar_envio_tienda` (`security definer`).
- **Interfaz de entrada de Consultas (F-CON-01, firma real)**: `publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje,
  producto_id) → uuid` (migración `20261205100100`). `private.entregar_a_bandeja(empresa, origen, nombre, contacto, mensaje, producto)` es el
  único punto que la conoce: resuelve el dominio de la empresa en `dominio.tiendas` (orden determinista por dominio) y la invoca. Desde la migración `20261212100100` la RPC ya no es ejecutable por `anon` ni `authenticated` (solo `service_role` y el propietario), para que el único camino público sea `enviar_consulta_contacto` con su límite. Si la entrega falla, `enviar_consulta_contacto` deja un `raise warning` (sqlstate + sqlerrm) en el log del servidor y devuelve `error` genérico al cliente. Si esa firma cambia, solo cambia el adaptador.
- **Límite**: 5 envíos por hora por visitante y empresa (`private.limite_envios_tienda()`, una sola constante). Atómico con
  `pg_advisory_xact_lock` por (empresa, visitante); las filas de más de 24 h se podan en la misma función. Formulario y WhatsApp (F-TDA-14)
  comparten el cupo.
- **Idempotencia**: `unique (empresa_id, clave_envio)`; una clave repetida responde `ok` sin entregar de nuevo ni gastar cupo. El cliente genera
  una clave por intento: «Reintentar» la reutiliza, «Enviar otra» (o editar el texto tras un error) pide una nueva.
- **Visitante**: hash `sha256` de la IP del cliente (según `private.saltos_proxy_confiables()` de F-TDA-15) y la empresa; la IP nunca se
  guarda. Sin cabecera `x-forwarded-for` todos caen en un único cupo «sin-ip» (falla cerrada).
- **Falla de entrega**: `enviar_consulta_contacto` ejecuta registro + entrega en una subtransacción; si la bandeja falla se revierte el registro
  (no se gasta cupo) y el visitante ve el error genérico con «Reintentar».
- **Validación (D7)**: nombre ≤ 100; «Correo o WhatsApp» ≤ 120 con formato de correo o teléfono; mensaje ≤ 2000; todos obligatorios y recortados.
  El teléfono admite **8 a 15 dígitos** (el tope de 15 es el de la bandeja, que admite 7 a 15: así nunca rechaza lo que la tienda aceptó). Servidor
  (`private.validar_contacto_tienda`) y cliente (`contacto/validacion.ts`) son espejo; cambian juntos.
- **Respuestas**: `ok | invalido (campos) | limite (espera_segundos) | error`. `error` es idéntico para host desconocido, empresa desactivada y
  falla de entrega. Las respuestas no incluyen ids de organización, IP ni hash.
- **Texto**: todo se guarda y se muestra literal (nodos de React); un `<script>` escrito en el formulario no se interpreta.

## Reversión

Migración aditiva. Se deshace con una migración posterior que elimina, en este orden, las funciones `publico.enviar_consulta_contacto` y
`publico.contacto_por_dominio`, las `private` (`entregar_a_bandeja`, `registrar_envio_tienda`, `validar_contacto_tienda`, `visitante_hash`,
`limite_envios_tienda`), la tabla `dominio.tienda_envios` y la columna `dominio.empresas.horarios` (el detalle exacto está en el encabezado de
la migración). El código del front se revierte con `git revert -m 1` del merge de la historia.

## Contradicciones prototipo ↔ requisitos (para el PR)

1. El prototipo de **Empresas** no dibuja «Horarios de atención»; el campo se agrega por FR-014 (D2).
2. La **bajada** de «Contacto» sale del «Texto del pie de página» que la tienda ya configura (F-TDA-03); sin texto, no se muestra.
3. «Respondemos dentro de las 24 h» y el bloque «Retiro y envíos» del prototipo quedan fuera de alcance (ver matriz de la spec).
4. El menú de escritorio suma «Contacto» al final de la lista de categorías (el prototipo lo muestra en otra barra); el menú móvil lo pone después de «Inicio».

## Verificación

- `pnpm --filter @platform/web test` (Vitest + axe a 320/768/1440 px) y `pnpm test:db` (pgTAP; requiere `pnpm dev:supabase`).
- E2E: `pnpm --filter @platform/web test:e2e tienda-contacto` con el stack local (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
- La validación corre antes del límite: un envío inválido no consume cupo (aceptado; no hay tope global por empresa).
- El servidor manda en las longitudes (PG cuenta caracteres, JS UTF-16): con emojis el borde puede diferir en ±1 y responde `invalido`.
- Pendiente de confirmar en DEV: que `x-forwarded-for` llega a PostgREST (si no llega, todos comparten el cupo «sin-ip»; ver
  `private.saltos_proxy_confiables()`).

## Consulta por WhatsApp desde la ficha (F-TDA-14, MSF-433)

Misma épica MSF-212, otra historia: el visitante de la ficha de un producto abre WhatsApp con un mensaje armado y el
interés queda registrado en la bandeja de Consultas y ventas de **esa** empresa, con origen `whatsapp` y el producto.

### Qué hay

| Capa | Pieza |
|---|---|
| Base (`supabase/migrations/20261212121000_tienda_whatsapp.sql`) | `publico.registrar_consulta_whatsapp(host, producto, clave_envio)`; no crea ni altera tablas |
| Front público | `apps/web/src/lib/whatsapp.ts` (`normalizarNumero`, `armarMensaje`, `urlWhatsapp`); `apps/web/src/lib/registroWhatsapp.ts` (`registrarConsultaWhatsapp`); `apps/web/src/pages/tienda-publica/whatsapp/` (`BotonWhatsApp`, `DialogoWhatsApp`, `useContactoWhatsapp`, `IconoWhatsapp`); ficha: `rutas/producto.tsx` + `ficha/DatosProducto.tsx` (fila de acciones con el botón) |
| Pruebas | pgTAP `supabase/tests/database/tienda_whatsapp.test.sql`; Vitest `apps/web/src/lib/whatsapp.test.ts`, `apps/web/src/lib/registroWhatsapp.test.ts`, `apps/web/src/pages/tienda-publica/whatsapp/BotonWhatsApp.test.tsx`, `apps/web/src/pages/tienda-publica/whatsapp/DialogoWhatsApp.test.tsx`, `apps/web/src/pages/tienda-publica/FichaWhatsapp.test.tsx`; E2E `apps/web/e2e/tienda-whatsapp.e2e.ts` |

### Cómo se ve en la tienda

- El botón «Consultar por WhatsApp» aparece **solo** si la empresa tiene un número válido (8 dígitos o más): sin
  número, la ficha se ve sin botón y sin hueco. El número sale de `publico.contacto_por_dominio` (la misma lectura
  anónimo que usa la página de contacto; esta historia no edita `lib/tiendaContacto.ts`, que es de F-TDA-16).
- En la ficha (`/producto/:productoId`) el botón va en la fila de acciones, junto a «Ver más productos», como en
  el prototipo (`design/pantallas/MJC_Producto.dc.html`): el de WhatsApp filled con su ícono y el otro con
  borde. La fila usa el ancho del tema: a 320 px los dos botones ocupan el ancho completo y se apilan; desde
  `sm` (600 px) van en línea. El ancho completo lo lleva el **elemento que la fila acomoda** (el
  `data-testid="boton-whatsapp"`), no el botón: un `width: 100%` dentro de un contenedor de ancho automático
  se resuelve como `auto` (CSS 2.1 §10.3.2) y el botón quedaría más angosto que «Ver más productos». La ficha
  recibe el `host` y la empresa de **su** tienda (el contexto de la ruta), así que nunca mezcla empresas.
- El botón abre un diálogo con el título «Consultar por WhatsApp», la línea «<empresa> · <número>», la etiqueta
  «Mensaje que se va a enviar» con el mensaje ya armado (solo lectura) y los botones «Cancelar» y «Abrir WhatsApp».
  Se cierra con «Cancelar», Esc o clic fuera, sin efectos.
- «Abrir WhatsApp» abre `https://wa.me/<dígitos>?text=<mensaje codificado>` en una pestaña nueva con `noopener`,
  cierra el diálogo y avisa «Se abrió WhatsApp con el mensaje listo.». El registro del interés va **después** de
  abrir WhatsApp y no espera a la respuesta: ni el límite ni una falla se le muestran al visitante.
- El diálogo se carga diferida (entra al bundle recién cuando la tienda tiene un número) y es accesible: `role="dialog"`
  con título asociado, foco inicial en el título, foco atrapado y devuelto al botón que lo abrió.
- **Tokens**: el botón y el diálogo usan los tokens del tema (`primary`, `success`, `background`, `divider`), sin
  colores sueltos, como el resto del front público. El verde de WhatsApp del prototipo (`#25D366`) se reemplaza por
  `success` del tema: con texto blanco ese verde da ~2:1 de contraste (WCAG AA pide 4.5:1) y el texto quedaba
  ilegible.

### Decisiones y contratos

- **Esquemas (Principio VII)**: sin tablas nuevas; la función vive en `publico` (superficie de `anon`) y reusa, sin
  modificarlas, `private.catalogo_tienda_efectivo` (visibilidad efectiva), `private.registrar_envio_tienda` (límite e
  idempotencia) y `private.entregar_a_bandeja` (único adaptador hacia MSF-122).
- **Versión de la migración**: el plan y `tasks.md` nombran `20261202110000_tienda_whatsapp.sql`, pero la migración real
  de F-TDA-16 quedó en `20261212120700_tienda_contacto.sql`; esta usa `20261212121000` para aplicarse **después** de las
  funciones que reutiliza (con el nombre del plan, una base desde cero fallaría porque `registrar_envio_tienda` todavía
  no existiría). La versión `20261212110000` que tenía antes **chocaba** con `20261212110000_listar_comprobantes.sql`
  de `dokploy`: dos archivos con la misma versión rompen el registro de migraciones (la segunda nunca se aplicaría y
  `publico.registrar_consulta_whatsapp` no existiría en el entorno). Por eso quedó en `20261212121000`, libre y mayor
  que la máxima de `dokploy` (`20261212120600`). Al mergear la base `dokploy` (2026-10-27) se reversionaron las dos
  migraciones de F-TDA-16 a `20261212120700_tienda_contacto.sql` y
  `20261212120800_crear_consulta_publica_solo_interna.sql`, libres y mayores que `20261212120600`.
- **Dependencia dura de F-TDA-16 (para quien opera el despliegue)**: esta migración **no se puede aplicar sin la de
  F-TDA-16**: `publico.registrar_consulta_whatsapp` llama `private.registrar_envio_tienda` y `private.entregar_a_bandeja`,
  que nacen en `20261212120700_tienda_contacto.sql`, y el front lee el número con `publico.contacto_por_dominio`, que
  también nace ahí. Postgres valida el cuerpo de la función al crearla (`check_function_bodies`), así que si esa
  migración no está aplicada la de WhatsApp **falla con error explícito** (y la cola de migraciones se detiene) en vez
  de dejar una función a medias: falla ruidoso, que es lo que hay que querer. Las versiones ya quedaron libres y
  mayores que la máxima de `dokploy` (`20261212120600`), así que el guard `scripts/verificar-migraciones.mjs` (que
  corre en `pnpm docs:check`) las acepta.
- **Producto visible**: el producto tiene que ser **efectivamente visible** en la tienda del host (activo, no oculto y
  con la categoría visible): es la misma visibilidad que usa la ficha. Un producto de otra empresa, inactivo u oculto
  responde `error` **igual** que un host desconocido o una empresa desactivada, y **no registra nada** (tampoco consume
  cupo): el anónimo no puede sondear qué productos o dominios existen.
- **Límite e idempotencia compartidos** con el formulario (D3): misma tabla `dominio.tienda_envios`, mismo visitante
  (hash de la IP), misma constante de 5 por hora y misma `unique (empresa_id, clave_envio)`. Superado el límite, el
  enlace **igual abre WhatsApp** (es una acción del visitante) y solo se omite el registro.
- **Datos del visitante**: el que abre WhatsApp no deja sus datos en la plataforma y F-CON-01 exige nombre y contacto
  no vacíos, así que la consulta se registra con las marcas `Visitante de WhatsApp` y `visitante@sin-datos.invalid`
  (TLD reservado por RFC 2606: nunca resuelve a una casilla real). No se inventa un nombre ni un teléfono; el mensaje
  va `null` y la bandeja muestra que el visitante no dejó mensaje.
- **Respuestas**: `ok | limite | error`, sin claves fuera de esa lista (nada de ids de organización, IP ni hash del
  visitante). El límite **no** se le muestra al visitante (FR-024).
- **Privilegios de la RPC**: `publico.registrar_consulta_whatsapp` es `SECURITY DEFINER` (la empresa sale del host,
  nunca del cliente) y su `EXECUTE` queda para `anon` y `authenticated` **nada más**: la migración hace
  `revoke execute … from public, anon` y después `grant execute … to anon, authenticated`. El `revoke … from public`
  importa: por defecto PostgreSQL le da `EXECUTE` a PUBLIC en toda función, así que sin ese `revoke` cualquier rol
  (no solo los de API) podría registrar consultas en la bandeja de una tienda. El pgTAP lo comprueba mirando el ACL
  real de la función (`aclexplode`), no solo `has_function_privilege` (que respondería `true` para `anon` igual si
  PUBLIC tuviera el privilegio).
- **`search_path` vacío**: la RPC lleva `set search_path = ''`, como las demás funciones `security definer` del repo.
  Es la regla de seguridad de la familia de funciones de `publico` (y el riesgo clásico de `security definer`: sin él,
  un objeto sin cualificar puede resolver a otra cosa que el dueño). El pgTAP lo asserta, así que una regresión se ve.
- **Ninguna falla interna escapa al anónimo**: todo el cuerpo de la RPC corre dentro de una sub-transacción con un
  único manejador `when others`. Cualquier falla (visibilidad del producto, cuota o entrega) responde el mismo
  `{"estado":"error"}` genérico; al llamante anónimo nunca le llega el mensaje crudo de PostgreSQL (FR-061). El
  detalle queda solo en el log del servidor y con `sqlstate` (el mensaje puede traer datos del visitante). Una falla de
  entrega tampoco gasta cupo: la sub-transacción revierte el registro del envío.
- **Clave de la apertura**: el front manda un `uuid` v4 por apertura (FR-024). La base deduplica por
  `unique (empresa_id, clave_envio)`, así que la clave tiene que ser distinta **entre visitantes** también: si dos
  visitantes compartieran clave, el segundo vería su consulta descartada en silencio (la RPC responde `ok` y no llega
  nada a la bandeja). Sin Web Crypto (tienda abierta por http, contexto no seguro) la clave se arma con
  `crypto.getRandomValues` y, si tampoco existe, con una semilla por sesión del navegador (hora + `Math.random`) más
  el contador de aperturas: no es entropía criptográfica —la clave no es un secreto—, pero reparte las claves entre
  visitantes. El front **valida** el producto y la clave como `uuid` antes de mandarlos (`esIdValido`): la base los
  guarda en columnas `uuid`, así que un valor malformado se rechazaría y la consulta se perdería en silencio (el
  visitante no ve fallas, FR-024). El Vitest exige que la clave que llega al registro sea un uuid v4.
- **Reversión**: migración aditiva; se deshace con una migración posterior que hace
  `drop function publico.registrar_consulta_whatsapp(text, uuid, uuid)` (el detalle está en el encabezado de la
  migración). El front se revierte con `git revert -m 1` del merge de la historia.

### Verificación

- pgTAP `supabase/tests/database/tienda_whatsapp.test.sql` (SC-006): producto visible, rechazo idéntico de oculto /
  inactivo / de otra empresa (de la misma organización y de otra) / host desconocido / empresa desactivada, límite
  compartido con el formulario, idempotencia, origen `whatsapp`, aislamiento entre organizaciones y respuestas sin
  datos internos. También comprueba **quién** puede ejecutar la RPC: `anon` y `authenticated` sí, `PUBLIC` no (el
  `revoke … from public` de la migración está aplicado) y ningún rol ajeno al dueño. Además asserta que la RPC es
  `security definer` con `search_path` vacío, que `dominio.consultas` tiene RLS (de eso depende el aislamiento) y que
  **una falla interna** —simulada con un stub que rompe la búsqueda del producto— responde el mismo error genérico,
  sin registrar consulta ni gastar cupo.
- Vitest `apps/web/src/lib/whatsapp.test.ts` (FR-022, FR-023): número normalizado (con menos de 8 dígitos no hay
  número), mensaje con y sin precio y URL de `wa.me` con el texto codificado. El número no puede romper la URL: solo
  quedan dígitos en el camino y el esquema es siempre `https` (nunca `javascript:`).
- Vitest `apps/web/src/lib/registroWhatsapp.test.ts` (FR-024): una llamada a `registrar_consulta_whatsapp` con el
  host, el producto y la clave de la apertura; límite, error del servidor y corte de red vuelven como estado (no
  lanzan) y un producto que no es un identificador válido ni se envía. **Una clave de apertura que no sea un
  identificador válido tampoco se envía** (la base la guarda en una columna `uuid`): se rechaza antes de la llamada,
  se anota en la consola y el visitante no ve nada. La clave de la apertura es un uuid v4 válido y
  distinto en cada apertura también sin `crypto.randomUUID` (contexto no seguro: la tienda abierta por http) y sin
  Web Crypto, y **dos visitantes (dos sesiones) no comparten la primera clave** (si la compartieran, la base
  descartaría en silencio la consulta del segundo).
- Vitest `apps/web/src/pages/tienda-publica/whatsapp/BotonWhatsApp.test.tsx` (FR-020): el botón aparece solo con
  número válido (sin número, con número corto, mientras carga o si la lectura falla, la ficha queda sin botón y sin
  hueco), al tocarlo abre el diálogo con el mensaje armado y **ocupa el ancho completo del elemento que la fila de
  acciones acomoda** (en jsdom no hay layout: se comprueba el CSS que MUI generó).
- Vitest `apps/web/src/pages/tienda-publica/whatsapp/DialogoWhatsApp.test.tsx` (FR-021, FR-023, FR-024, FR-026):
  textos del diálogo y mensaje solo lectura; «Cancelar», Esc y clic fuera cierran sin efectos; «Abrir WhatsApp» abre
  `wa.me` con `noopener`, cierra y avisa; el registro no bloquea la apertura y ni el límite ni las fallas se ven;
  la clave que llega al registro es un **uuid v4** y cada apertura usa la suya; foco inicial en el título, foco
  atrapado y devuelto al botón; axe sin violaciones a 320 / 768 / 1440 px.
- Vitest `apps/web/src/pages/tienda-publica/FichaWhatsapp.test.tsx` (SC-007): la ficha de punta a punta — con
  número válido el botón está en la fila de acciones junto a «Ver más productos»; sin número (o con un número
  corto) la ficha se queda sin botón y **sin hueco** (la fila no deja elementos vacíos); el diálogo muestra la
  línea «empresa · número» y el mensaje con el precio de la ficha (y sin paréntesis si el producto no tiene
  precio); «Abrir WhatsApp» abre la URL de `wa.me` codificada con `noopener`, cierra y avisa; Esc cierra sin
  efectos y devuelve el foco al botón; el registro se hace una vez por apertura con el host, el producto y una
  clave **uuid v4** de la ficha, y ni una falla ni el límite se muestran al visitante; axe sin violaciones a
  320 / 768 / 1440 px, con la ficha y con el diálogo abierto.
- E2E `apps/web/e2e/tienda-whatsapp.e2e.ts` (SC-008): con las dos tiendas del seed, ficha → diálogo → «Abrir
  WhatsApp» (la URL de `wa.me` se verifica y la red no se toca: `wa.me` se responde con una página muda) → la
  consulta llega a la bandeja de **su** empresa con origen `whatsapp` y el producto (la otra empresa no recibe
  nada), a 320 px el botón ocupa el ancho completo de la fila de acciones y una empresa sin número no muestra el
  botón. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`: ver `docs/e2e-app.md`.
