# Revisión de seguridad: analítica avanzada y resumen por correo (MSF-265)

Alcance: épica MSF-265, spec `specs/20261101-100000-analitica-avanzada-y-resumen-por-correo/`. Cubre las dos
entregas de la épica: la **galería de tableros analíticos** (F-REP-07, spec 007) y el **resumen semanal por correo**
(F-REP-08, MSF-287). La pregunta que la épica dejó abierta —la excepción a la regla de la spec 007— está resuelta en
«La excepción a 007 FR-013».

Método: lectura de cada objeto nuevo contra `CLAUDE.md`, la constitución (Principios I, III, VII y VIII) y
`docs/aislamiento-por-organizacion.md`; los objetos de F-REP-08 se verificaron contra el código de esta rama
(migraciones `20270324101000` y `20270324101100`, flow `resumen-semanal` y sus pruebas) y los de F-REP-07 contra la
línea de despliegue del producto, donde esa historia está integrada.

## Resultado

**Sin hallazgos críticos ni altos.** La épica **no abre ninguna excepción a 007 FR-013**: la regla de que el
administrador no accede a Superset sigue intacta. Quedan cuatro observaciones de bajo riesgo, documentadas en
«Riesgos residuales».

## La excepción a 007 FR-013

La spec 007 (FR-013) dice: «El sistema NO DEBE otorgar a ningún administrador ni miembro de organización acceso
directo a Superset (edición de reportes, datasets, charts, o consultas) — su único acceso es la visualización embebida
de reportes ya asignados».

La épica dejó abierta si el administrador **arma** sus tableros (lo que cruzaría esa regla) o **elige** entre tableros
ya armados. La entrega es la segunda, y por lo tanto:

- **No hay excepción**: no se creó ningún rol de Superset con permisos de edición, no se habilitó la edición de
  dashboards, datasets ni charts, y `emitir-acceso-reporte` no cambió. El administrador sigue viendo tableros
  embebidos, no la consola de Superset.
- **El aislamiento no depende de la galería**: la separa la cláusula `rls` del guest token, que arma el servidor
  (`organizacion_id` y, si el tablero declara `filtro_empresa`, las empresas accesibles). Un tablero nuevo se suma a
  los existentes sin abrir una puerta nueva.
- **Armar tableros sigue siendo una historia aparte**: si el cliente lo pide, esa historia tiene que resolver dónde se
  persisten los tableros (P2 de la spec), con qué permisos acotados y con qué reversión, y recién ahí abrir una
  excepción explícita a 007 FR-013. Nada de esta épica la presupone.

## RLS y esquemas (Principios VII y I)

| Objeto | Esquema | Control |
|---|---|---|
| `dominio.resumen_semanal_envios` (F-REP-08) | `dominio` (dato del producto: el resumen de cada organización y la clave de idempotencia del envío) | RLS activa; `revoke all … from public, anon, authenticated`: la app no lee ni escribe la cola. Escriben solo las funciones `private` |
| `public.tipos_aviso` (fila `resumen_semanal`) | `public` (catálogo de plataforma de MSF-189) | No es tabla nueva: se registra un tipo. RLS vigente del catálogo |
| Vistas `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` (F-REP-07) | `analitica` (solo vistas) | Sin privilegio para `anon`, `authenticated` ni `public`; `select` solo para `superset_analitica`. Cada fila expone `organizacion_id` y `empresa_id` |
| `public.reportes` y sus tablas hermanas (F-REP-07) | `public` (plataforma, spec 007) | No cambian de estructura: la migración agrega dos filas de catálogo y tres disparadores. RLS vigente |

`analitica` no contiene tablas, así que la prueba `rls_en_toda_tabla` (que recorre `public` + `dominio`) sigue verde
con las dos vistas nuevas. Verificación: `supabase/tests/database/rls_en_toda_tabla.test.sql`,
`supabase/tests/database/resumen_semanal.test.sql` y `supabase/tests/database/analitica_tableros_avanzados.test.sql`.

## Grants y `anon`

- `anon` no tiene privilegios sobre la tabla ni sobre las vistas nuevas, y no puede ejecutar ninguna función nueva.
- Las cinco funciones del resumen (`private.*`) están con `revoke execute … from public, anon, authenticated`; el
  `grant execute` va **solo** a `kestra_orquestacion` (dentro de un `do $$` que lo condiciona a que el rol exista).
- Las tres funciones que Kestra ejecuta (`reclamar_resumen_semanal`, `marcar_resumen_semanal_enviado`,
  `registrar_fallo_resumen_semanal`) pasan por el guardia `private.exigir_llamante_kestra()`: si un `revoke`/`grant`
  futuro dejara entrar a otro rol, la función se niega en vez de devolver los correos y los datos del negocio.
- El tipo `resumen_semanal` se lee por `public.listar_preferencias_aviso()` (`revoke … from public, anon` +
  `grant … to authenticated`), que además filtra por sección: solo quien tiene acceso a `rentabilidad` lo ve en
  «Avisos por correo».

## `security definer` y `search_path`

Las cinco funciones del resumen son `security definer` con `set search_path = ''` y referencias calificadas; la
organización y el destinatario llegan por argumento porque quien llama es el rol de servicio de Kestra (sin sesión).
La política de lectura de la cola, aunque exista, es inerte: el privilegio de tabla está revocado.

## Secretos

- El SMTP es el mismo de los avisos (`KESTRA_SMTP_*`): sin proveedor nuevo y sin secretos nuevos.
- El rol de base `kestra_orquestacion` y su contraseña se siguen configurando por entorno (`.env` de Kestra); en Git
  solo hay `.env.example`.
- El motivo que queda en la base tras un fallo de SMTP es fijo («No se pudo enviar el correo»), nunca el mensaje del
  SMTP: ese mensaje puede traer hosts, IP o credenciales.
- El rol de Superset sigue siendo de solo lectura (`superset_analitica`, `nologin`): el navegador nunca recibe
  credenciales de administración, solo un guest token acotado.

## Aislamiento del embebido (F-REP-07)

- El guest token lo emite el servidor con la organización que resuelve `resolver_organizacion_reporte` **como el
  usuario** (nunca la que mande el cliente) y, por `filtro_empresa = true`, solo con las empresas accesibles de quien
  mira. Los identificadores se validan uno por uno antes de interpolarse: lo que no es UUID se descarta, y sin
  empresas resolubles **no se emite token** (falla cerrada).
- Los filtros que preselecciona la pantalla (período y tienda) son un filtro de datos, no un control de acceso:
  manipularlos en la URL solo reduce lo visible.
- El tablero de margen exige la sección `rentabilidad` (`resolver_organizacion_reporte` devuelve null sin ella → 403
  → «Acceso restringido»). **La galería es «solo administradores» únicamente en la pantalla** (`usePuedeEscribir`);
  el servidor exige la **sección** del tablero, igual que con todos los demás reportes embebidos. Quien tuviera la
  sección y el reporte asignado podría pedir el token por fuera de la pantalla, pero ese token sigue acotado a su
  organización y a sus empresas accesibles: no hay fuga de aislamiento ni escalada. Exigir el rol en el servidor
  cambiaría el contrato de la spec 007 para todos los reportes y es una historia aparte.
- La asignación automática a todas las organizaciones no da acceso a datos ajenos: asignar es visibilidad del reporte,
  el acceso a las filas lo decide el token. **Acoplamiento por prefijo**: cualquier reporte registrado con el nombre
  «Analítica · …» se asigna a todas las organizaciones; registrar reportes solo puede el superadmin (o el importador
  server-side con la clave de servicio), así que el riesgo es de nombre, no de acceso.

## Contenido del correo (F-REP-08)

- El resumen se arma por organización y con las secciones a las que el destinatario tiene acceso: no se mezclan
  organizaciones ni datos ajenos al permiso de quien recibe el correo.
- Solo se incluyen agregados (totales, conteos y nombres de producto en alerta), nunca datos de clientes.
- Los valores del resumen se escapan en el cuerpo HTML del correo.
- La idempotencia es por destinatario y semana (`unique (organizacion_id, destinatario_id, semana)`): repetir la
  corrida no duplica el correo.

## Auditoría (Principio III)

Cada envío deja estado, intentos, `origen`, `creado_en`/`actualizado_en`/`enviado_en` y el error útil en
`dominio.resumen_semanal_envios`. Un envío interrumpido queda `fallido` con un motivo fijo, no en silencio.

## Riesgos residuales

1. **«Solo administradores» es de la pantalla, no del servidor**: el control real es la sección del tablero (ver
   arriba). Aceptado y documentado; cambiarlo afecta a todos los reportes embebidos.
2. **Acoplamiento por el prefijo «Analítica · »**: un tablero que no deba ser global no debe llevar ese prefijo.
3. **Entrega «al menos una vez»**: si el correo sale y la base no cierra el envío, el reintento puede duplicarlo; queda
   en los registros (mismo criterio que el resto de los correos del repo).
4. **Sin validación contra sistemas reales**: la importación de los tableros en un Superset real y el recorrido del
   correo de punta a punta no se validaron contra un entorno con datos (seguimiento **MSF-949**).
