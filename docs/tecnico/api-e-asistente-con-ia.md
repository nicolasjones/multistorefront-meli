---
owner: tecnico
sources:
  - specs/016-capacidad-ia-gobernada
  - specs/20261003-200240-gateway-ia
  - specs/20261005-chat-companion-mechanism
  - specs/20261005-170000-servidor-mcp-generico
  - specs/20261005-document-rag-mechanism
  - packages/ia
  - packages/mcp-server
  - supabase/migrations/20261003230000_mcp_servidor_ia.sql
  - supabase/migrations/20261003232000_mcp_credenciales_rpc.sql
  - supabase/migrations/20261005000000_chat_companion_mechanism.sql
  - supabase/migrations/20261005000001_rag_busqueda_documental.sql
---

# API y asistente con IA (MSF-233)

**Estado: Backlog, fuera de alcance.** La épica no tiene spec propia todavía
(no existe `specs/api-e-asistente-con-ia/`), no tiene migraciones ni pantallas
propias y no se construyó. Esta página registra el estado real para que la
documentación no prometa lo que no existe, y deja el punto de partida para
cuando la épica pase a un hito.

- **Componente:** Plataforma.
- **Alcance de entrega previsto:** `refine`, `supabase`, `kestra`, `workers`.
- **Disparador:** solo se activa si el cliente lo pide. Los requisitos de cada
  historia se redactan al pasar a un hito; hoy no hay criterios de aceptación
  acordados.
- **Origen de las piezas existentes:** el template. `F-IA-01` es de
  configuración sobre mecanismos ya presentes; `F-API-01` no tiene base en el
  template (no hay claves de API ni webhooks salientes).

## Historias

| ID | Historia | Talla | Base en el template | Estado |
|---|---|---|---|---|
| F-API-01 | API y avisos hacia otros sistemas | L | **No existe.** Hay PostgREST/RPC con sesión de usuario, conexiones OAuth entrantes y una cola de eventos interna, pero no hay claves de API por organización ni webhooks salientes. | Backlog |
| F-IA-01 | Asistente con IA sobre el catálogo | M | **Existe el mecanismo.** IA gobernada, chat flotante, servidor MCP y RAG ya están portados al template; falta que este producto registre las capacidades de consulta del catálogo. | Backlog |

## Lo que ya existe (mecanismos del template)

Estos mecanismos están versionados en el repo y no forman parte de esta épica;
se citan porque son la base sobre la que se apoyaría `F-IA-01`.

| Mecanismo | Dónde vive | Spec / capacidad | Qué resuelve |
|---|---|---|---|
| Núcleo de IA gobernada | `packages/ia/` (`prepararInvocacion`, `invocarProveedorIa`), `supabase/migrations/20260920153631_capacidad_ia_gobernada.sql` y siguientes | `specs/016-capacidad-ia-gobernada`, `specs/20261003-200240-gateway-ia` | Proveedor y modelo elegidos por superadmin, claves en Vault, contratos de consumidor, políticas, límites, trazas y sanitización. |
| Chat companion | `apps/web/src/components/ia/ChatFlotante.tsx`, `supabase/functions/chat-ia-responder`, tablas `capacidades_chat_ia` y `fuentes_chat_ia` | `specs/20261005-chat-companion-mechanism` | Chat que lee datos de funcionalidades registradas y propone acciones con confirmación humana. |
| Servidor MCP | `packages/mcp-server/`, `infra/mcp-server/`, tablas `capacidades_mcp`, `fuentes_mcp`, `acciones_mcp`, `credenciales_mcp` | `specs/20261005-170000-servidor-mcp-generico` | Clientes externos de IA con credencial por organización leen o proponen acciones sobre funcionalidades registradas. |
| Búsqueda documental (RAG) | `supabase/functions/indexar-documento`, `supabase/functions/preguntar-documentos`, migración `20261005000001_rag_busqueda_documental.sql`, pantalla `apps/web/src/pages/ia/documentos.tsx` | `specs/20261005-document-rag-mechanism` | Preguntar sobre documentos propios citando la fuente; aislado por organización y por versión activa. |

La administración de estos mecanismos vive en `/ia` (solo superadmin) y las
pantallas de chat y documentos del menú de organización ya existen
(`apps/web/src/components/navegacion/destinosPanel.ts:79`). No hay que
reimplementarlas.

## Qué falta para F-IA-01

`F-IA-01` no requiere tablas nuevas: el mecanismo ya resuelve el transporte, la
gobernanza y la auditoría. Lo que falta es **declarar las capacidades de
consulta del catálogo** en las tablas que cada mecanismo ya expone:

- `capacidades_chat_ia` / `fuentes_chat_ia`: marcar lectura de las vistas de
  catálogo y registrar la vista de solo lectura por funcionalidad.
- `capacidades_mcp` / `fuentes_mcp` / `acciones_mcp`: si el asistente se expone
  a clientes externos, declarar lectura y acciones con el mismo criterio.
- Habilitar la funcionalidad (`chat-ia`, `busqueda-documental` o la que
  corresponda) por organización con `public.habilitar_feature`, y definir el
  system prompt del producto.
- Cargar los casos de uso y verificar que cada consulta devuelve solo datos de
  la organización activa.

Mientras no se registren esas capacidades, el chat no puede leer el catálogo:
`private.puede_chat_leer_funcionalidad` devuelve `false` y la interfaz responde
que no tiene acceso, igual que con cualquier funcionalidad sin declarar.

## Qué falta para F-API-01

`F-API-01` no tiene base en el template y necesita spec propia antes de
construirse. El inventario real de la superficie de integración es:

- **Entrada de datos:** conexiones OAuth vía Nango (`integraciones_oauth`,
  `conexiones_oauth`) para leer servicios de terceros.
- **Lectura por IA:** servidor MCP con credencial por organización.
- **Eventos internos:** la cola durable `public.cola_eventos` publica eventos
  de dominio para consumidores internos; no hay entrega HTTP saliente.
- **Panel:** PostgREST y RPC con la sesión del usuario y RLS.

No existe: clave de API por organización, tabla de suscripciones a eventos,
entrega firmada con reintentos ni revocación/rotación de credenciales de
integración. Eso coincide con los ítems 35 (claves de API por organización) y
36 (webhooks salientes) del [backlog priorizado](../roadmap-template.md), ambos
en estado Exploración y condicionados a un consumidor externo real.

Una definición razonable —a confirmar en la spec— necesitaría, como mínimo:
claves con alcance por organización y hash persistido, suscripciones de webhook
por organización y evento, una cola de entregas con firma y reintentos, y
auditoría de cada entrega. **No se crea nada de eso en esta épica.**

## Modelo de datos

**Sin cambios de esquema.** La épica no crea, altera ni borra tablas,
columnas, RPC ni políticas. Los mecanismos de IA citados ya tienen su esquema
en `supabase/migrations/20260920*`, `2026100323*` y `2026100500*`; el detalle
está en [Datos y DER](datos.md).

## Seguridad

- La configuración de proveedores, contratos y políticas de IA es **solo
  superadmin**; el administrador de organización no la ve ni la modifica.
- Las capacidades de chat y MCP se declaran a nivel plataforma y arrancan
  **fail-closed**: sin fila, lectura y ejecución quedan en `false`.
- Toda lectura se filtra por `private.organizacion_id()` en SQL; nunca se
  filtra en TypeScript ni se usa la service-role en el navegador.
- Las credenciales MCP se guardan hasheadas (`credenciales_mcp.hash`), se
  muestran una sola vez y se revocan con efecto inmediato
  (`20261003232000_mcp_credenciales_rpc.sql`).

## Cómo probarlo

Hoy solo se puede verificar el **estado de partida**; no hay comportamiento
nuevo que probar porque la épica no se construyó. **Sin video.**

### Prerrequisitos

- Stack local con `pnpm dev:supabase` y `pnpm dev`.
- Un superadmin de plataforma y una organización con datos de catálogo.
- `psql` contra la base local (o el SQL Editor de Supabase Studio).

### Pasos

1. Comprobar que no existe superficie de integración saliente: en `psql`,
   ejecutar `\dt public.*` y confirmar que **no** hay tablas de claves de API,
   suscripciones de webhook ni entregas. Resultado visible: ninguna tabla
   `api_keys`, `webhooks` o `webhook_entregas`.
2. Abrir `/ia/capacidades-chat` como superadmin. Resultado visible: la tabla de
   funcionalidades muestra los toggles **Lectura** y **Ejecución** en `false`
   hasta que se activen explícitamente.
3. En `psql`, ejecutar
   `select feature_id, lectura, ejecucion from public.capacidades_chat_ia order by feature_id;`.
   Resultado visible: ninguna fila de catálogo con `lectura = true` mientras la
   épica siga en Backlog.
4. Abrir `/ia/chat` como usuario de la organización y preguntar por un producto
   del catálogo. Resultado visible: el chat responde que no tiene acceso a esos
   datos; no inventa productos ni precios.

### Resultado esperado

- **Given** una organización con catálogo cargado, **When** se pregunta al chat
  por sus productos, **Then** responde que no tiene acceso porque la capacidad
  de lectura del catálogo no está declarada.
- **Given** un superadmin en `/ia/capacidades-chat`, **When** revisa las
  funcionalidades, **Then** todas arrancan con lectura y ejecución en `false`.
- **Given** el esquema de la base, **When** se listan las tablas de
  integración, **Then** no hay claves de API ni webhooks salientes.

### Cómo automatizarlo

Todavía no hay tests de esta épica: no hay comportamiento nuevo que automatizar.
Cuando se construya, la cobertura prevista es:

- `[MSF-233:T001]` — pgTAP: `capacidades_chat_ia` y `capacidades_mcp` arrancan
  fail-closed y solo el superadmin puede modificarlas.
- `[MSF-233:T002]` — pgTAP: una lectura de catálogo vía chat devuelve solo filas
  de la organización activa y nunca cruza organizaciones.
- `[MSF-233:T003]` — E2E Playwright: el chat responde sobre un producto del
  catálogo y cita la fuente correcta.
- `[MSF-233:T004]` — pgTAP o worker: una entrega de webhook firmada se reintenta
  y queda auditada (solo si `F-API-01` se aprueba).

## Fuera de alcance y pendientes

- **Fuera de alcance:** API pública con claves, webhooks salientes, asistente
  configurado sobre el catálogo, pantallas nuevas y cualquier cambio de esquema.
- TODO (dueño: Producto): redactar los requisitos de `F-API-01` y `F-IA-01` y
  confirmar con el cliente si la épica pasa a un hito.
- TODO (dueño: Ingeniería): crear `specs/api-e-asistente-con-ia/` con su
  `plan.md` y `tasks.md` al iniciar la épica; esta página se reemplaza entonces
  por la documentación de lo construido.
- TODO (dueño: Documentación/QA): capturas del manual cuando exista una
  pantalla propia de la épica; hoy no hay pantalla nueva, por eso no se generan.

## Reversión

No aplica: la épica no tiene migraciones ni código propios. Si en el futuro
declara capacidades de chat o MCP, la reversión es desactivar la funcionalidad
en `organizaciones_features` y volver los toggles a `false`; los mecanismos del
template ya documentan su propia reversión en el encabezado de cada migración.
