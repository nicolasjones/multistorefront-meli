# Suite E2E de la app (Playwright)

Seguimiento MSF-499. La suite vive en `apps/web/e2e/` (`@playwright/test` 1.61.0,
la misma versión que la imagen de `infra/playwright`, que es un servidor remoto
para workers y **no** corre estos tests).

## Correr

```bash
pnpm build            # el webServer usa `vite preview` sobre el build
pnpm --filter @platform/web exec playwright install chromium   # una vez
pnpm test:e2e         # o E2E_BASE_URL=http://... para apuntar a una web ya servida
```

- Los archivos usan el sufijo `.e2e.ts`: Vitest (`pnpm test`) no los recoge.
- Los recorridos con sesión necesitan `pnpm dev:supabase` y usuarios sembrados;
  el setup sembrará con la API admin desde Node (la service-role key nunca llega
  al navegador).

## Base local creada solo con migraciones

Los E2E con sesión siembran con la service-role key. Desde la migración `20270302105000`, `service_role` tiene
USAGE sobre `dominio`, lectura y escritura sobre sus tablas operativas y
EXECUTE sobre los helpers que usan defaults y consultas (`dominio.nombre_norm`, `private.quitar_prefijo_importacion`,
`private.normalizar_host`, `private.documento_normalizado`, `private.nivel_seccion`, `private.normalizar_busqueda` y
`private.clave_texto`, estos dos usados por índices por expresión; el grant de `normalizar_busqueda` ya existía y se
repite a propósito, por si una re-creación de la función pierde su ACL): no hace falta dar grants
a mano para sembrar, con una excepción: las tablas de solo-agregar o inalterables y `consultas` **siguen sin grant de
escritura** (solo SELECT, y `precios_propios_historial` ni eso), así que un E2E no las siembra con un INSERT directo
sino con la RPC `security definer` que corresponda (p. ej. `publico.crear_consulta_publica` para una consulta). `anon` y
`authenticated` no cambian.

Reglas para quien agrega objetos (las vigila el pgTAP `service_role_privilegios`): no hay privilegios por defecto,
así que una tabla nueva de `dominio` (y sus secuencias, si las tuviera) lleva su `grant ... to service_role` en su propia migración
(o se declara inalterable en la lista de la migración y del test); y todo helper puro que use un trigger (o que este llame), una
columna generada, un CHECK, un índice por expresión o una vista lleva EXECUTE para `service_role` (y `authenticated` si lo usa la app).
El guard del pgTAP solo ve nombres literales en el cuerpo de las funciones: no detecta SQL dinámico con el nombre armado
en ejecución (p. ej. `format('select public.%I(1)', ...)`). Regla de E2E: ningún spec escribe directo en las tablas
inalterables ni en `dominio.consultas`; se siembran por RPC.

Prerrequisitos: `pnpm install --frozen-lockfile` y Docker con las imágenes de Supabase (se bajan solas en el primer
`supabase start`, o antes con `pnpm exec supabase start` en un entorno con red).

Receta para un stack propio (un `supabase start` normal falla porque PostgREST arranca antes de que existan los
esquemas expuestos). Todos los pasos se corren desde la raíz del repo; reemplazá `PID` por tu `project_id`:

1. En `supabase/config.toml` (solo en tu copia, no se commitea) poné `project_id = "PID"` y cambiá los puertos fijos
   (`[api] port` 9300, `[db] port` 7634, `shadow_port` 7633, `[db.pooler] port` 57329, `[studio] port` 4301,
   `[inbucket] port` 4302, `inspector_port` 8084 y `[analytics] port` 57327) a un rango libre, para no chocar con otro
   stack. Abajo, `API` es el puerto de `[api]`.
2. Levantá la base, migrá y sembrá:

```bash
pnpm exec supabase start --ignore-health-check -x studio,imgproxy,logflare,vector,supavisor,postgres-meta
pnpm exec supabase migration up --local
docker exec -i supabase_db_PID psql -U postgres -d postgres < supabase/seed.sql
docker restart supabase_rest_PID
```

   `edge-runtime` y `realtime` quedan arriba a propósito: `service-seguimiento`, `tienda-seo` y el caso «recuperar» de
   `cuenta-web-cliente` usan funciones Edge, y `stock-actual-vivo` necesita Realtime. Si NO vas a correr esos specs podés
   sumar `edge-runtime` y/o `realtime` a la lista de `-x` para un stack más liviano (y sin Edge, `tienda-seo` responde 500: es lo
   esperado, no un bug).

3. Compilá la web contra ese stack. Las claves salen de `pnpm exec supabase status -o env` (`ANON_KEY` y
   `SERVICE_ROLE_KEY`). El build lee `VITE_SUPABASE_PUBLISHABLE_KEY` (no `..._ANON_KEY`: con otro nombre el build usa
   una clave inválida y todos los ingresos fallan con «Error al iniciar sesión») y `VITE_PANEL_HOSTS`; sin
   `VITE_PANEL_HOSTS=localhost,127.0.0.1` el panel se sirve en `mundojc.localhost` y los E2E de la tienda fallan:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:API VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> \
  VITE_PANEL_HOSTS=localhost,127.0.0.1 pnpm build
(cd apps/web && pnpm exec vite preview --port 4467 --strictPort --host 0.0.0.0) &
```

   `--strictPort` es obligatorio: sin él, si el puerto está ocupado Vite elige otro y los tests le pegan a la web de
   otra persona. Servila en `0.0.0.0` (el default del repo), no en `--host 127.0.0.1`: los specs de la tienda entran por
   `mundojc.localhost`/`sanjavucho.localhost` y Chromium resuelve `*.localhost` también a `::1`; atado solo a IPv4 el
   `page.goto` termina en `net::ERR_ABORTED`. El `webServer` de Playwright expira a los 60 s, por eso se sirve aparte y se pasa `E2E_BASE_URL`.
4. Exportá las variables y corré los specs. Sin `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los tests con sesión se
   **omiten en silencio**:

```bash
export SUPABASE_URL=http://127.0.0.1:API SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> SUPABASE_ANON_KEY=<ANON_KEY>
export E2E_BASE_URL=http://127.0.0.1:4467 WEB_PORT=4467
pnpm --filter @platform/web exec playwright test precios-masivos tienda-promocion --workers=1
```

5. Para bajar todo: `pnpm exec supabase stop --no-backup` (con tu `project_id`).

Alcance del desborde a 320 px: este cambio corrige `BusquedaGlobal` y `MenuCuenta`; el mismo patrón `width: 1` copiado
en otros componentes lo corrige el PR #876, no este.

## Requisitos de algunos specs y guardián de escritura directa

- `service_role` solo **lee** `dominio.consultas` y las tablas de solo agregar (historiales, `movimientos_stock`,
  `lotes_stock`...). Los specs siembran esos datos por la RPC de negocio (p. ej. `publico.crear_consulta_publica` con una
  fila en `dominio.tiendas`) y no los borran a mano: la baja de la organización se los lleva (salvo los ingresos de
  mercadería, que son RESTRICT hacia productos: `limpiarOrganizacion` de `e2e/soporte/fixtures.ts` los borra antes). Los
  specs que necesitan consultas, productos o empresas siembran una organización PROPIA por corrida y la dan de baja al
  terminar; no usan las del demo (no se pueden limpiar). `pnpm e2e:escritura:check`
  (y `pnpm test:e2e:escritura`, ambos en `validate.yml`) falla si un spec de `apps/web/e2e` hace INSERT/PATCH/DELETE
  directo sobre esas tablas; leerlas está permitido y una línea se exime con `escritura-directa: ok — <motivo>`.
- `service-seguimiento` necesita `SEGUIMIENTO_IP_SALT` en el runtime de **Edge**, no en Playwright: se exporta (o va en
  `supabase/.env`) antes de `supabase start`, porque `config.toml` lo declara en `[edge_runtime.secrets]`.
- `ventas-impresion` corre el worker real: compilá `workers/comprobantes-pdf` (`pnpm build` en ese paquete) y exportá
  `E2E_PGPORT` con el puerto de la base local; el spec crea el rol `worker_<organización>` con los permisos del
  aprovisionamiento y lo elimina al terminar.
- `stock-actual-vivo` necesita Realtime (no excluirlo con `-x realtime`).
- `cuenta-web-cliente` ingresa por los subdominios de la tienda y el enlace de invitación vuelve al `site_url` de
  `supabase/config.toml` (`http://127.0.0.1:4300`, con sus `additional_redirect_urls`): la web tiene que servirse en ESE
  puerto (`vite preview --port 4300 --strictPort`) o el caso «invitación → definir contraseña» no llega a la pantalla. El caso
  «recuperar» además necesita Edge y el SMTP de Mailpit (`SMTP_*`) declarado para el runtime.
- Los recorridos largos fijan `test.setTimeout` con el motivo de cada spec (30-90 s); el tope por defecto (30 s) no alcanza con
  varios roles o con mucha siembra.
- `inicio` ubica cada tarjeta por su título (`tarjeta()` en `e2e/inicio.e2e.ts`). Desde MSF-820 «Stock hoy» aparece dos
  veces en la portada del panel: el bloque del tablero (`BloqueStock`, primero en el DOM) y la tarjeta de alertas de stock
  (`TarjetaStock`, la que el spec verifica, siempre la última); el helper toma `.last()` para no violar el modo estricto de
  Playwright sin cambiar lo que se afirma. Si una pantalla suma otro título repetido, acotá el locator a su región en lugar
  de encadenar más `.first()`/`.last()`.
- Un spec no se salta solo según lo que ve en pantalla: `locator.count()` no espera y los listados llegan por una RPC
  asíncrona, así que un `test.skip(!hayAlgo)` basado en un conteo instantáneo oculta la verificación (así `tienda-disponibilidad`
  no comprobaba nada). Las únicas omisiones válidas son las del entorno, declaradas al inicio del `describe` o con su variable
  (`E2E_SUPERSET`, `E2E_INVENTARIO_CORREO`, falta de `SUPABASE_URL`). `tienda-disponibilidad` siembra una categoría propia por
  tienda y abre `/catalogo?categoria=<id>` (la lista pagina de a 24); `catalogo-productividad` espera la respuesta de
  `v_productos_listado` con el sufijo buscado antes de marcar «Seleccionar todos», porque aplicar la búsqueda descarta la
  selección por diseño.

## Estado de cobertura

| Recorrido | Tarea | Estado |
| --- | --- | --- |
| Ruta protegida → ingreso, camino a recuperación, enlace vencido, sin registro | MSF-119 T020 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Ingreso con sesión, cierre de sesión | MSF-119 T020 | Pendiente: fixtures por rol |
| Acceso restringido + Rentabilidad por URL | MSF-125 T019 | Pendiente |
| Rentabilidad con tres roles: Administrador edita el umbral (10 % → 3 %) y desaparece el aviso; Administración ve el aviso sin el botón; Operador y Consulta ven «No tenés acceso a esta sección» (SC-008) | MSF-553 T032 | Escrito: `e2e/rentabilidad-roles.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e rentabilidad-roles`. No monta el tablero de Superset (necesita un Superset real): el aviso, el diálogo y el acceso salen de la base y la pantalla. La limpieza borra también la Actividad de la organización de prueba (el umbral guardado deja un evento). Guía: `docs/rentabilidad.md` |
| Ventas impresión de punta a punta: factura confirmada → imprimir factura y remito → marca y reimpresión → presupuesto → PDF → correo; registra la latencia de generación (SC-009) | MSF-565 T035 | Escrito: `e2e/ventas-impresion.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Corre el worker real compilado contra el Postgres local; el tramo SMTP exige `E2E_CORREO_KESTRA=1`. Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local). Guía: `docs/ventas-impresion.md` |
| Reportes de ventas: Operador y Consulta ven «No tenés acceso a esta sección» (y el servidor rechaza `leer_ranking_ventas` con 42501), Administración y Administrador ven la pantalla, el cambio de empresa reencuadra el filtro de tienda y el Administrador exporta el ranking a `.xlsx` | MSF-338 T015 | Escrito: `e2e/ventas-reportes.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). El tablero de Superset no se monta (necesita un Superset real). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local). Guía: `docs/ventas-reportes.md` |
| Reportes de inventario: con la sección `stock` «Productos y stock» y «Reposición» muestran su título; sin ella, «No tenés acceso a esta sección»; la descarga CSV real (solo filas filtradas, `;` y coma decimal) corre únicamente con `E2E_SUPERSET=1` | MSF-140 T014 | Escrito: `e2e/reportes-inventario.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local ni Superset). Guía: `docs/reportes-inventario.md` |
| Ventas RMA: factura confirmada → «Nueva devolución» (ítem, forma, motivo) → RMA con número `RMA-####` y su ítem en el listado (SC-002) | MSF-288 T009 | Escrito: `e2e/ventas-rma.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; aborta si `SUPABASE_URL` no es local). Siembra organización, empresa, cliente, producto y factura confirmada con la API admin/RPC y limpia al final. Guía: `docs/ventas-rma-devoluciones.md` |
| Editar/suspender/reactivar usuarios | MSF-125 T036 | Pendiente |
| Matriz de permisos | MSF-125 T043b | Pendiente |
| Empresas (listar, editar, pausar/reactivar, cambiar) | MSF-138 T011/T017/T021/T025 | Pendiente |
| Permisos por empresa: asignar desde Usuarios, cambiar de empresa activa y nivel de edición resuelto | MSF-121 T022 | Escrito: `e2e/permisos-por-empresa.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No hay pantalla de una sección por empresa (Ventas/Consultas) todavía: el nivel se comprueba sobre la respuesta de `permisos_actuales` que decide los botones de edición |
| Inicio con tres roles (Administrador ve todo, Consulta solo lee, Mostrador no ve la tarjeta de Consultas) y cambio de empresa activa que recarga las tarjetas sin datos de la anterior (SC-001, SC-002, SC-003) | MSF-578 T024 (MSF-156) | Escrito: `e2e/inicio.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Siembra dos tiendas, productos sin stock y con stock bajo y consultas con la API admin, y limpia al final. Se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e inicio`. Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker). Guía: `docs/inicio-y-alertas.md` |
| Editar la organización | MSF-132 T010/T017 | Pendiente |
| Actividad: ruta sin sesión → ingreso | MSF-463 T015 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Actividad: listado con filtros, búsqueda y paginación (administrador/operador) | MSF-463 T015 | Pendiente: fixtures por rol (seguimiento) |
| Actividad: detalle de un cambio de rol (Antes/Después) y de una baja con «—» del lado nuevo | MSF-170 (F-AUD-02) | Escrito: `e2e/actividad-detalle.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; el job `application` solo corre `acceso-publico`, así que no está verificado en el CI). Desvío: no se ejecutó (sin stack local). El E2E del acceso de soporte no se escribió: `service_role` no puede sembrar un superadmin |
| Clientes: la ficha muestra el «Saldo deudor» y la tabla «Cuenta corriente» con los comprobantes con saldo (F-CLI-19) | MSF-451 T005 | Escrito: `e2e/cuenta-corriente-cliente.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; aborta si `SUPABASE_URL` no es local; el job `application` solo corre `acceso-publico`, así que **no está verificado en el CI**). Usa el cliente 9100 del seed. Cobertura en el CI: pgTAP `cuenta_corriente_cliente` y Vitest de `ComprasCliente` |
| Clientes: alta, búsqueda y exportación a Excel (SC-001) | MSF-180 T017 | Pendiente: fixtures por rol (seguimiento MSF-499); cubierto mientras tanto por Vitest (`pages/clientes`, `lib/exportarClientes`) y pgTAP |
| Ingreso de mercadería: dos productos con costo → stock sube → historial → anular → stock vuelve a 0 y el ingreso queda anulado (SC-001…003) | MSF-219 T019 | Escrito: `e2e/ingresos-mercaderia.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Aborta si `SUPABASE_URL` no es local. |
| Catálogo del ingreso de mercadería: con 501 productos el selector avisa «Hay más de 500 productos» y, al escribir, deja elegir el que queda fuera del tope (MSF-693) | MSF-693 BUG | Escrito: `e2e/ingresos-mercaderia-catalogo.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Siembra 501 productos con la API admin y limpia al final. Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local ni daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e ingresos-mercaderia-catalogo`. Guía: `docs/ingreso-de-mercaderia.md` |
| Stock: entrada 10 → salida 4 → ajuste a 3 → stock 3 y tres filas en el historial; salida de 5 rechazada con «No hay stock suficiente» (SC-001) | MSF-136 T021 | Escrito: `e2e/stock-movimientos.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge (T024) y aborta si `SUPABASE_URL` no es local. Seguimiento: MSF-499 |
| Precios: producto en USD con costo → precio en dos empresas con reglas distintas → interruptor de IVA → precio final y margen (SC-009) | MSF-114 T043 | Escrito: `e2e/precios-iva.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker ni al CLI de Supabase); se corre a mano con `pnpm dev:supabase` antes del merge del cierre. Seguimiento: MSF-499 |
| Tienda: precio anterior tachado durante una promoción y precio normal fuera de ella (SC-006) | MSF-439 T020 | Escrito: `e2e/tienda-promocion.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). No se corrió en el entorno del Desarrollador (sin Supabase local); se corre con `pnpm dev:supabase` antes del merge |
| Precios masivos: +10 % sobre costo y lista → vista previa antes → después sin escribir → confirmar → precios cambiados (SC-003) | MSF-436 T009 | Escrito: `e2e/precios-masivos.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: la spec lo nombra `precios-masivos.spec.ts`, pero el `testMatch` del repo es `**/*.e2e.ts`; no se pudo ejecutar en el entorno del Desarrollador (sin acceso al daemon de Docker), se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e precios-masivos` |
| Dólar y recálculo: cargar 1050 con vigente 1000 → vista previa por empresa → confirmar → precios recalculados; cargar 1005 → se registra sin recalcular (SC-009) | MSF-547 T031 | Escrito: `e2e/cotizacion-recalculo.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e cotizacion-recalculo` |
| Service: fotos y adjuntos del equipo: subir una foto, verla, quitarla; otra organización no lee el objeto (SC-003) | MSF-134 T012 | Escrito: `e2e/service-adjuntos.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e service-adjuntos`. Guía: `docs/service-adjuntos.md` |
| Stock: 20 salidas simultáneas sobre stock 10 → 10 aceptadas, 10 rechazadas, stock 0, 10 movimientos y 10 eventos `stock.actualizado` (SC-001) | MSF-249 T007 | Escrito: `e2e/stock-concurrencia.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge. Contrato y cola: `docs/stock-eventos.md` |
| Stock completo: 2.º depósito → entrada 10 → trasladar 4 → reservar 3 → disponible 7 → descontar → cantidad 7 y reservado 0; concurrencia mixta (traslado + reserva + salida, 18 RPC en paralelo) sin sobreventa (SC-003, SC-008) | MSF-546 T032 | Escrito: `e2e/stock-depositos-reservas.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Aborta si `SUPABASE_URL` no es local. Desvío: no se corrió en el entorno del Desarrollador (sin daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge. Detalle: `docs/stock.md` |
| Catálogo: crear, editar, subir fotos y desactivar con Administrador y Operador; eventos en Actividad sin costo (SC-001, SC-006) | MSF-456 T025 | Desvío: pendiente de fixtures por rol (MSF-499); cubierto por pgTAP `catalogo_*` y Vitest de `pages/productos` |
| Service técnico: alta con 2 ítems (total 5.500), estados hasta «Entregado» con «María Pérez», remito sin costos y aparición en el listado (SC-007) | MSF-538 T030 | Escrito: `e2e/service-recorrido.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e service-recorrido` |
| Tienda online: con los dos dominios del seed, identidad, textos y catálogo visible de cada tienda cambian solo la propia (SC-003) | MSF-543 T038 | Escrito: `e2e/tienda-dos-dominios.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` del CI). Desvío: no se ejecutó en el entorno del Desarrollador (sin Docker); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e tienda-dos-dominios`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Tienda online · dominio y publicación: con dos empresas, alta de dominio, verificación (DNS simulado con service-role desde Node), borrador, publicar, restaurar y publicar; los cambios de una no tocan la otra ni lo que ve `anon` (SC-003) | MSF-779 T024 | Escrito: `e2e/tienda-publicacion.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-publicacion`. Guía: `docs/tiendas-online.md` |
| Cuenta web del cliente: invitación → definir contraseña → ingresar → salir; suspendida / sin cuenta en la tienda / no habilitada no entran con el mismo mensaje; recuperar responde igual con y sin cuenta (SC-005, SC-006) | MSF-428 T027 | Escrito: `e2e/cuenta-web-cliente.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; el caso de recuperar además necesita `supabase functions serve` y se omite si la Edge Function no responde). Desvío: no se ejecutó en el entorno del Desarrollador (sin Supabase CLI ni Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e cuenta-web-cliente`. El enlace de definir contraseña se pide con `generate_link` (Admin API) en vez de leer el correo; siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Tienda online: el menú de cada tienda del seed lista solo sus categorías y una categoría oculta o de la otra tienda muestra la 404 (SC-003 de MSF-167) | MSF-386 T009 | Escrito: `e2e/tienda-categorias.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Desvío: no se ejecutó en el entorno del Desarrollador (sin Docker); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e tienda-categorias`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Catálogo: Administrador ve la columna Costo y el Operador no; ambos ven la disponibilidad, filtran por «A pedido» y encuentran un producto escaneando su código de barras (FR-016, SC-005) | MSF-540 T022 | Escrito: `e2e/catalogo-costo-disponibilidad.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e catalogo-costo-disponibilidad` |
| Catálogo: en la ficha del producto, el bloque «Productos relacionados» arranca vacío, busca por nombre/SKU/categoría, agrega, reordena con ↑, guarda con «Guardar cambios» y el orden guardado se vuelve a leer igual al reabrir la ficha; quitar uno lo saca de verdad (FR-014…FR-017, SC-003) | MSF-416 T008 (F-CAT-18) | Escrito: `e2e/productos-relacionados.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e productos-relacionados`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local. Guía: `docs/catalogo.md` |
| Consultas: la tienda envía por la RPC pública → aparece en la bandeja en menos de 5 s → llega el aviso a Mailpit → el enlace abre el detalle → asignar, anotar y resolver; Lectura solo ve, Mostrador no accede y otra organización no la ve (SC-004, SC-008) | MSF-548 T026 | Escrito: `e2e/consultas-recorrido.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y la función servida, ver `docs/consultas.md` |
| Verificación manual 320/768/1440 px y lector de pantalla | MSF-125 T018 | Pendiente (manual) |
| Contacto de la tienda: datos de cada tienda, consulta que llega a la bandeja de su empresa con origen formulario, ráfaga de 6 envíos (el sexto muestra la espera, la bandeja recibe 5) y HTML literal (SC-004, SC-005) | MSF-437 T013 | Escrito: `e2e/tienda-contacto.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` del CI). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-contacto`. Restaura los datos de las empresas del seed y limpia consultas y envíos de prueba. Guía: `docs/tienda-contacto.md` |
| Consulta por WhatsApp desde la ficha: en las dos tiendas del seed, ficha → diálogo → «Abrir WhatsApp» (la URL de `wa.me` se verifica y la red no se toca) → la consulta llega a la bandeja de su empresa con origen whatsapp y el producto, y la empresa sin número no muestra el botón (SC-008) | MSF-433 T028 | Escrito: `e2e/tienda-whatsapp.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` del CI). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker ni al CLI de Supabase); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-whatsapp`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local. Guía: `docs/tienda-contacto.md` |
| Tienda pública: tras más de 12 h sin actividad, el primer clic del visitante NO lo manda a `/login` (404 en la tienda) ni revoca su sesión global (cierre local y vuelta a `/`, MSF-700) | MSF-673 | Escrito: `e2e/tienda-sesion-vencimiento.e2e.ts` (no necesita la base: adelanta la marca `sesion:ultima-actividad` 13 h con un init script y vigila que no haya navegación a `/login` ni pedido a `/auth/v1/logout` (el cierre local no llama al servidor); en local se omite si el build no define `VITE_PANEL_HOSTS`, porque entonces el host no se sirve como tienda; en el CI (`CI`) FALLA en vez de omitirse, para no dar un falso verde). Verificado en local contra `vite preview` con `VITE_PANEL_HOSTS=localhost,127.0.0.1` |

### Quién ejecuta el E2E con sesión (`permisos-por-empresa.e2e.ts`)

Ningún job del CI público lo corre: necesita el stack local de Supabase. Se ejecuta a mano antes
del merge, en el runner self-hosted o en la máquina de desarrollo:

```bash
pnpm dev:supabase
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm test:e2e -- permisos-por-empresa.e2e.ts
```

El test siembra su propia organización, empresas y usuarios, y los borra en un `finally`. En el
entorno del Desarrollador de MSF-510 no hay Docker ni CLI de Supabase, así que esta corrida
queda como paso previo al merge (T024/T026), no como evidencia ya obtenida.

### Specs que necesitan algo más que el stack mínimo

- `tienda-seo` (`robots.txt` y `sitemap.xml`) pide el archivo a la Edge Function `tienda-seo` con `X-Tienda-Host`,
  igual que hace nginx en producción (`apps/web/nginx.conf`, bloque `location ~ ^/(robots\.txt|sitemap\.xml)$`): el
  servidor de `vite preview` no los sirve ni tiene por qué. Si arrancaste excluyendo `edge-runtime`,
  Kong responde 500 (`supabase_edge_runtime_<proyecto>` no resuelve): es lo ESPERADO sin las funciones servidas, no un bug del producto. Se corre con las funciones servidas:
  `pnpm exec supabase functions serve --no-verify-jwt` en otra terminal.
- `e2e/panel-sin-desborde.e2e.ts`: `/productos`, `/clientes` y `/consultas` sin scroll horizontal de la página a 320, 375 y
  1280 px, y axe a 320 px en esos listados, comprobantes, proveedores, presupuestos y con el menú lateral abierto.
  Con sesión de administrador sembrada con la API admin; no deja datos.
- Los specs de la tienda (`tienda-*`) cambian el estado de la empresa (p. ej. `tienda-seo` la desactiva un momento) y
  comparten las dos tiendas del seed: correrlos con `--workers=1`.
- El build de la web lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (no `VITE_SUPABASE_ANON_KEY`); sin la
  clave la tienda muestra «No pudimos cargar esta página».

## CI

`validate.yml` corre los specs públicos como pasos del job de plataforma (después de
`pnpm build`: instala Chromium con `--with-deps` y ejecuta `pnpm test:e2e -- acceso-publico.e2e.ts`).
El paso `build` corre si el diff tiene `code` **o** afecta a la app web (`web`): un cambio que toca
`apps/web` sin ser código por extensión (p. ej. `apps/web/nginx.conf`) deja `code=false` pero
`web=true`, y sin el build el e2e fallaba por `apps/web/dist` ausente.
Si el E2E falla, sube `playwright-report` y `test-results` como artefacto (`if: failure()`).
El `WEB_PORT` en CI se deriva del run (`4400 + run_id % 100`) para no colisionar si dos jobs corren en
paralelo en el runner self-hosted.

El comando del `webServer` ejecuta antes `e2e/verificar-dist.mjs`, que falla con
un mensaje claro si falta `apps/web/dist` (Playwright levanta el `webServer`
antes que `globalSetup`; tampoco corre al importar la config, así
`--list`/`codegen` siguen andando). Si ya hay un servidor en `WEB_PORT` se
reutiliza (fuera de CI); los specs afirman headings propios de la app, así que
otro servicio ahí falla en vez de dar falso verde. Chromium se instala con `--with-deps`
(al runner self-hosted le faltaban las librerías del sistema) y, aun con **cache hit** del
binario, se corre `playwright install-deps chromium`: el cache de `~/.cache/ms-playwright`
guarda el **binario**, no las libs del SO (`libglib-2.0`, etc.), y sin ellas el browser moría
con `error while loading shared libraries` → falso rojo de e2e en PRs ajenos (2026-10-19).
Los recorridos con
sesión (tabla de arriba) requieren un stack con API (`kong` + `postgrest`), que el de `database` omite: los de la tienda
corren en el job aparte `e2e-tienda` (sección siguiente); el resto (`permisos-por-empresa`, `stock-*`, `service-*`,
`ventas-*`...) siguen sin correr en el CI y abiertos en las tasks.md de origen.

## E2E de la tienda pública en el CI (`e2e-tienda`)

El job `e2e-tienda` de `validate.yml` corre los 20 `apps/web/e2e/tienda-*.e2e.ts` en cada PR que toca la web, con la
misma política que el resto del e2e: solo si `changes.web == 'true'` y `changes.e2e == 'true'` (un PR a `epic/*`, no) y
no en borrador, ni con `CI_PAUSED`, ni con la variable de repo `CI_E2E_TIENDA=false` (kill switch), y no en PRs de forks (los
jobs pesados no corren código de forks en los runners self-hosted; `validacion` falla en un PR de fork en vez de dar verde con todo
`skipped`). Entra en `needs` de `validacion` y de `liberar`, pero **arranca NO bloqueante**: el job lleva
`continue-on-error: ${{ vars.E2E_TIENDA_BLOQUEA != 'true' }}`, así que mientras esa variable de repo no sea `true` un fallo (o no
conseguir ranura) deja el job en rojo pero llega como `success` a `validacion` y el PR se puede mergear. Se pasa a **requerido**
poniendo `E2E_TIENDA_BLOQUEA=true` tras ~10 corridas verdes seguidas en PRs a `dokploy` (seguimiento en
`specs/20261113-120000-ci-e2e-tienda/tasks.md`, T011).

Qué hace, en orden (cada paso explica su motivo en el workflow):

1. Reserva una **ranura** del stack del CI (`scripts/supabase-ci.mjs reclamar`, la misma reserva que `database`, hasta 5
   corridas del repo en paralelo; sin ranura libre espera) y `db:ci:preparar` deriva su `project_id` `ci-…` y sus puertos.
2. Baja lo que haya en esa ranura (`supabase stop --no-backup`: puede venir con el stack de `database`, que no trae
   `kong`/`postgrest`) y levanta `supabase start --ignore-health-check -x studio,mailpit,imgproxy,logflare,vector,edge-runtime,supavisor,realtime,postgres-meta`:
   queda `db` + `auth` + `storage` + `kong` + `postgrest`. `--ignore-health-check` hace falta porque PostgREST arranca
   antes de que las migraciones creen `dominio` y no queda sano hasta después.
3. `pnpm db:reset:ci` aplica las migraciones y `supabase/seed.sql` (las dos tiendas `mundojc.localhost` y
   `sanjavucho.localhost`), se **reinicia el contenedor `supabase_rest_<project_id>`** (recarga el esquema) y se espera a que
   `/rest/v1/` responda 200 y a que `dominio.tiendas` devuelva las dos tiendas del seed; si no, el job falla ahí con el log de PostgREST.
4. Las claves salen de `supabase status -o env` (nunca de git; la service-role se enmascara en el log). Dentro del contenedor
   del runner `127.0.0.1` es el propio contenedor, así que `API_URL` se reescribe a **`host.docker.internal`** (publicado en el
   Docker del host): lo usan Node (siembra) y Chromium (el build). Se exportan `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PANEL_HOSTS=localhost,127.0.0.1`
   y `E2E_SIN_EDGE=1`. Los specs aceptan `host.docker.internal` como Supabase local (`HOSTS_LOCALES`).
5. `vite build` (sin `tsc`: el type-check ya lo hace `pnpm build` en `application`), Chromium con el mismo cache y las mismas
   `install-deps` que `application`, y `playwright test --workers=1 e2e/tienda-` (**un worker**: los specs pausan empresas
   y editan datos de las dos tiendas del seed; el `--` de pnpm llega literal a Playwright, por eso el filtro va sin él).
6. Siempre: limpieza de navegadores (`always()`), `supabase stop --no-backup` + `liberar` de la ranura, y si falla o se cancela se sube
   el artefacto `playwright-report-tienda` (`playwright-report`, `test-results` con trazas y `resultado-e2e.json`; 7 días de retención).

Ranuras y timeouts: el job espera a lo sumo 10 min por una ranura (`SUPABASE_CI_LOCK_MIN=10`; el default de `database` es 20)
y, si no hay, falla (no bloqueante mientras `E2E_TIENDA_BLOQUEA` no sea `true`; ya bloqueante, es el costo de no oversuscribir el
host). Su `timeout-minutes` es 55 y el TTL de las ranuras (`SUPABASE_CI_LOCK_TTL_MIN`) sube a 75 min en `e2e-tienda` **y en
`database`**: quien reclama es quien recicla las ranuras vencidas, así que todos los jobs que las comparten deben usar el mismo TTL,
por encima del mayor timeout. Caso marginal: una cancelación forzada del runner (o un reinicio del host) no ejecuta ni los pasos
`always()`; los contenedores `ci-…` quedan arriba y la ranura ocupada hasta el TTL, y el próximo job de esa ranura los baja con su
`supabase stop` inicial (o se bajan a mano). El job también espera, además de PostgREST y el seed, a `Auth` (`/auth/v1/health`) y
`Storage` (`/storage/v1/status`) antes de seguir.

Límites a propósito:

- **Sin Edge Runtime.** `supabase functions serve`/`edge-runtime` monta el directorio de funciones del checkout en un
  contenedor del Docker del host, y esa ruta solo existe dentro del contenedor del runner (docker-fuera-de-docker; el
  mismo motivo por el que `pg_prove` corre por `host.docker.internal`). Por eso `E2E_SIN_EDGE=1` omite el único caso que lo
  necesita, `robots.txt`/`sitemap.xml` de `tienda-seo` (su handler se cubre con `pnpm test:edge:tienda-seo` en el job `web`).
  Sigue corriéndose a mano con las funciones servidas (sección «Specs que necesitan algo más»).
- **Omisiones silenciosas.** En el CI un spec que se omite es un hueco, no un verde. 18 de los 20 specs se omiten solos a
  nivel `describe` si faltan `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (y Playwright lo cuenta como éxito), así que el job
  corre al final `pnpm e2e:omitidos:check apps/web/resultado-e2e.json --max=1`: lee el reporte JSON de Playwright (reporter
  `json` con `CI`) y falla si hay más de un omitido (el único permitido es el de `tienda-seo` con `E2E_SIN_EDGE=1`) o si no
  corrió nada (`scripts/verificar-e2e-omitidos.mjs`; su test corre en `application` con `pnpm test:e2e:omitidos`).
  Además `tienda-sesion-vencimiento` falla (no se omite) en el CI si el build no sirve el host como tienda, y
  `tienda-disponibilidad` no tiene `test.skip` dinámicos (omitía su verificación porque `locator.count()` no espera y la carga
  infinita dejaba el producto sembrado fuera de la primera tanda; ahora siembra una categoría propia y abre `/catalogo?categoria=<id>`).
  Solo queda su omisión de entorno al inicio del `describe`, cubierta por la guarda de arriba.
- `playwright.config.ts` ajusta, solo con `CI`, los topes de espera porque el runner self-hosted corre cargado: `expect` 15 s
  (5 s en local; el primer render de una ficha que consulta la base superó 5 s y dio un falso rojo en `tienda-relacionados`), test
  60 s (30 s en local; los recorridos largos fijan su propio `test.setTimeout`) y arranque del `webServer` 120 s (60 s en local).
  Son topes de espera: no alargan lo que pasa cuando todo anda bien.
- Los demás specs con sesión siguen sin correr en el CI; sumarlos a este job es agregar su filtro y revisar su estado
  compartido, no rehacer el stack.

## E2E con sesión en CI: antecedente (`e2e-sesion`)

El job `e2e-sesion` (experimental, `continue-on-error`) se escribió y se desactivó (commit `8261188e`): levantaba el stack
con `kong`/`postgrest` sin `--ignore-health-check` y `supabase start` fallaba porque PostgREST arranca **antes** de que las
migraciones creen el esquema `dominio` (`schema "dominio" does not exist`). Lo reemplaza `e2e-tienda` (sección anterior),
que resuelve ese bloqueo con `--ignore-health-check` + migrar + reiniciar `supabase_rest_<project_id>`, y alcanza la API
por `host.docker.internal`. La plantilla del kit (`templates/calidad/e2e-sesion.job.yml`) no está en este repo.
Para sumar otros specs con sesión (`permisos-por-empresa`, `stock-*`...) se amplía el filtro de ese job; los que usan
Realtime (`stock-actual-vivo`), Edge o SMTP necesitan además esos servicios, que hoy el stack del CI no levanta.
