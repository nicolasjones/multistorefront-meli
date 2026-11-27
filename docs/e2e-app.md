---
owner: tecnico
sources:
  - apps/web/playwright.config.ts
  - apps/web/e2e/verificar-dist.mjs
  - .github/workflows/validate.yml
  - .github/workflows/e2e-nocturno.yml
  - scripts/verificar-e2e-omitidos.mjs
  - scripts/verificar-e2e-nocturno.mjs
  - scripts/verificar-e2e-sin-escritura-directa.mjs
  - scripts/armar-video-evidencia.mjs
  - scripts/publicar-videos-e2e.mjs
  - scripts/cobertura-e2e.mjs
  - scripts/historia-item.mjs
  - scripts/e2e-cobertura-epicas.py
---

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
- **Fixture compartido (`e2e/soporte/fixtures.ts`): usalo en los specs nuevos** y no copies `async function rest/leer/borrar/...`
  en cada archivo. Exporta `url` y `serviceKey` (con el guard «solo contra un Supabase local», que corre al importarlo: un spec
  no repite el suyo), `cabeceras`, `rest(ruta, cuerpo, esquema = 'public', prefer = 'return=representation')` (INSERT/upsert;
  `?on_conflict=` en la ruta y `UPSERT_FUSIONAR` como `prefer` para pisar la fila existente; con un `prefer` sin
  `return=representation` devuelve `[]`), `leer(ruta, esquema = 'public')` (SELECT con `accept-profile`; el esquema por defecto
  es `public`, así que las tablas de `dominio` llevan `'dominio'` explícito), `borrar(ruta, esquema = 'public')` (DELETE con
  el filtro en la ruta; si falla avisa con `console.warn` y sigue, porque es limpieza), `altaUsuario(correo, password)` y
  `borrarUsuario(id)` (API admin de Auth; la contraseña por defecto es `CONTRASENA_E2E`), `crearConsulta` (RPC pública) y
  `limpiarOrganizacion`. Los nombres de los helpers no son lectores para el guardián de escritura directa, así que
  `rest('consultas', ...)` o `borrar('movimientos_stock?...')` siguen marcándose igual que antes. Lo que NO está en el
  fixture se queda en el spec o en su archivo de soporte porque la firma es propia de ese flujo: las llamadas RPC con el JWT de
  una persona (`rpc`, `rpcComo`, `tokenDe`), `actualizar`/`modificar` (PATCH), `leer(consulta)` y `cabeceras` con perfil `dominio` por defecto
  en algunas tiendas, `cuenta-web-cliente` (`rest(metodo, ruta, cuerpo)`), `importaciones-soporte.ts`, `ventas-faltantes-soporte.ts`
  (`leer` con `dominio` por defecto, exportado a otros specs) y `ayuda`/`panel-sin-desborde` (`borrar` con la URL completa). `e2e/semillas.ts` (los helpers compartidos de `stock-historias`,
  `exportacion-total`...) re-exporta los del fixture y conserva `password`, `ingresar` y `tokenDe`. `avisos-acceso`, `ordenes-compra` y
  `stock-toma-inventario-categorias` también lo usan (lote MSF-879): conservan solo lo propio (`ingresar`, y en `ordenes-compra` el
  PATCH `actualizar`); el alta masiva de 250 productos pasa `prefer = 'return=minimal'` a `rest`. Los specs que siguen con helpers
  propios y el motivo están en «Fixture compartido y corridas pendientes».
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
  veces en la portada del panel: la tarjeta de alertas de stock (`TarjetaStock`, la que el spec verifica, con su enlace «Ver
  stock») y el bloque del tablero (`TableroInicio`). No se elige por posición en el DOM (el orden cambió y un `.last()` pasó a
  apuntar al tablero): el helper toma la que contiene el enlace «Ver stock». Si una pantalla suma otro título repetido, acotá
  el locator a su región o a un elemento propio de la tarjeta en lugar de encadenar `.first()`/`.last()`.
- Un spec no se salta solo según lo que ve en pantalla: `locator.count()` no espera y los listados llegan por una RPC
  asíncrona, así que un `test.skip(!hayAlgo)` basado en un conteo instantáneo oculta la verificación (así `tienda-disponibilidad`
  no comprobaba nada). Las únicas omisiones válidas son las del entorno, declaradas al inicio del `describe` o con su variable
  (`E2E_SUPERSET`, `E2E_INVENTARIO_CORREO`, falta de `SUPABASE_URL`). `tienda-disponibilidad` siembra una categoría propia por
  tienda y abre `/catalogo?categoria=<id>` (la lista pagina de a 24); `catalogo-productividad` espera la respuesta de
  `v_productos_listado` con el sufijo buscado antes de marcar «Seleccionar todos», porque aplicar la búsqueda descarta la
  selección por diseño.

## Ver y grabar las corridas (control directo)

- **UI interactiva (recomendado):** `pnpm test:e2e:ui` abre el Playwright UI: elegís un test, ves el navegador, el DOM, la línea de tiempo y la traza paso a paso.
- **Con navegador visible:** `pnpm test:e2e:headed`.
- **Grabar todo (video + traza):** `pnpm test:e2e:record`; quedan en `apps/web/test-results/` (video `.webm` + `trace.zip`).
- **Reporte HTML:** `pnpm test:e2e:report` (después de una corrida).
- **Abrir una traza:** `pnpm test:e2e:trace apps/web/test-results/<test>/trace.zip`.
- **Desde GitHub (manual):** Actions → **Validate** → **Run workflow** → activá **«Grabar video + traza»** (por defecto sí; fuerza build + e2e aunque no haya cambios de código, incluido `code=true`); al terminar, bajá el artefacto `playwright-report`.
- **Grabar una interacción y generar el test (codegen):** `pnpm test:e2e:codegen` (con la app corriendo en `http://localhost:4300`; o `E2E_BASE_URL=...`).

En CI (`validate.yml`) el artefacto `playwright-report` incluye el reporte HTML + `test-results` (videos y trazas) y se sube **siempre** (también si el test pasa), con retención de 14 días. Se descarga desde la pestaña **Artifacts** del run y se abre con `npx playwright show-report` o `npx playwright show-trace`.

**Control remoto por Tailscale (opcional):** en el nodo, `pnpm --filter @platform/web test:e2e:ui --ui-host=0.0.0.0 --ui-port=9323` y abrí `http://<nodo>:9323` desde tu máquina en la tailnet. El `webServer` levanta el build/preview; requiere el stack de la app.

## Grabar un recorrido funcional (una sola toma)

Para ver las pantallas de la app sin correr los tests:

1. **Guardá una sesión (una vez).** Con la app corriendo (o `E2E_BASE_URL` apuntando a DEV):
   ```bash
   pnpm test:e2e:storage
   ```
   Se abre el navegador; ingresá y cerralo. Guarda `apps/web/auth.json` (tokens: no se versiona).

2. **Grabá el recorrido:**
   ```bash
   PANTALLAS_APP_URL=https://dev.212-90-120-53.sslip.io    PANTALLAS_ESTADO=apps/web/auth.json    pnpm pantallas:video
   ```
   Queda **`apps/web/pantallas-capturas/app-recorrido.webm`**, con un rótulo por pantalla.

3. **Elegí las rutas** (default `clientes,productos,empresas,usuarios,stock`):
   ```bash
   PANTALLAS_RUTAS=clientes,productos,ventas,historial,reportes PANTALLAS_PAUSA=4000 ...
   ```

Sin `PANTALLAS_APP_URL`, graba el recorrido de los prototipos (`design/pantallas`) como `prototipo-recorrido.webm`.

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
| Avisos de acceso: el Operador ve «No tenés acceso a esta sección» en `/empresas` y `/organizacion` (sin error rojo) y un aviso informativo de «Solo lectura» en el detalle de la empresa; el Administrador no ve ninguno de los dos | MSF-639 | Escrito: `e2e/avisos-acceso.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Siembra una organización con una tienda y dos personas (Administrador y Operador) con la API admin y limpia al final. Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e avisos-acceso`. Guía: `docs/empresas.md` |
| Permisos por empresa: asignar desde Usuarios, cambiar de empresa activa y nivel de edición resuelto | MSF-121 T022 | Escrito: `e2e/permisos-por-empresa.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No hay pantalla de una sección por empresa (Ventas/Consultas) todavía: el nivel se comprueba sobre la respuesta de `permisos_actuales` que decide los botones de edición |
| Gastos: cargar un gasto, verlo en el total del mes, anularlo con motivo y verlo con «Mostrar anulados» | Gastos fase 2 | Escrito: `e2e/gastos.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Los gastos se cargan por la pantalla (RPC), no por REST |
| Inicio con tres roles (Administrador ve todo, Consulta solo lee, Mostrador no ve la tarjeta de Consultas) y cambio de empresa activa que recarga las tarjetas sin datos de la anterior (SC-001, SC-002, SC-003) | MSF-578 T024 (MSF-156) | Escrito: `e2e/inicio.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Siembra dos tiendas, productos sin stock y con stock bajo y consultas con la API admin, y limpia al final. Se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e inicio`. Ejecutado y en verde en el job `e2e-visible-sesion` del CI (corrida 43730923693, 2 tests, MSF-747): `service_role` no escribe `usuarios_empresas`, así que el Administrador sembrado asigna tiendas y roles con la RPC `asignar_empresas_usuario` con su propia sesión. Guía: `docs/inicio-y-alertas.md` |
| Editar la organización | MSF-132 T010/T017 | Pendiente |
| Actividad: ruta sin sesión → ingreso | MSF-463 T015 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Actividad: listado con filtros, búsqueda y total (Administrador): 12 eventos recientes, búsqueda por texto, filtro por tipo, período de 30 días y estado vacío con filtros | MSF-463 T015 (MSF-879) | Escrito: `e2e/actividad-filtros.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Siembra el registro de actividad de su propia organización por SQL directo (`sql()`: `service_role` no tiene INSERT sobre `registro_actividad`) y limpia al final (las filas se van con la baja de la organización). Sin corrida firmada todavía: se corre con `e2e_sesion=true` y `e2e_archivos=e2e/actividad-filtros.e2e.ts`. Pendiente: el recorrido del Operador y la carga de la segunda tanda. Vigilar el margen del `test.setTimeout(300_000)`: la corrida de CI midió 7,1 min en total contra esos 300 s (el tiempo por test es menor, pero el margen es corto); si el test empieza a cortarse por tiempo, medir antes de subir el límite |
| Inicio · tablero de gestión con tres roles: el Administrador ve «Resumen por tienda» con ingresos, «Salidas por depósito», «Actividad reciente» y «Movimientos por producto» (búsqueda, vista «En alerta», orden y exportación `.csv`); Consulta lee sin «Exportar»; Operador no ve ingresos; si falla «Resumen por tienda» solo ese bloque muestra el error y se recupera con «Reintentar» (RF-INI-05-7) | MSF-851 (MSF-881) | Escrito: `e2e/inicio-tablero.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Siembra una sola vez (en serie, `beforeAll`) una organización con una tienda, tres personas y tres productos y limpia en `afterAll`: en paralelo y con una siembra por test agotaba los 5 min en el job de sesión. Corrida firmada: job `e2e-visible-sesion` en success (4 passed) en el run 44112057707; el run global falló por `web (1)` y `validacion`, ajenos al spec; se corre con `e2e_sesion=true` y `e2e_archivos=e2e/inicio-tablero.e2e.ts`. Pendiente: carga infinita con más de una tanda y exportación con depósito elegido |
| Newsletter de la tienda: axe (WCAG 2 A y AA) y sin desborde del formulario del pie (vacío y con errores) y de `/newsletter/confirmar/:token` a 320, 768 y 1440 px (dos tests por viewport: el formulario del pie y la página de confirmación; cada uno resuelve antes el aviso de cookies si aparece, que a 320 px tapa el botón «Suscribirme»; en el stack de sesión no aparece) | MSF-961 (MSF-468 T009) | Escrito: `e2e/tienda-newsletter-a11y.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Usa la tienda `mundojc.localhost` del seed, enciende la bandera `newsletter` y el interruptor de la tienda para la corrida y los devuelve a su valor previo. Corre en el job `e2e-tienda` (filtro `e2e/tienda-`), no en `e2e-visible-sesion`, que no sirve la tienda pública: no se lanza con `e2e_archivos`. Sin corrida firmada todavía: cualquier violación que aparezca se corrige en el componente |
| Newsletter de la tienda, recorrido de la persona: suscribirse desde el pie (queda `pendiente` con su consentimiento), un enlace de confirmación desconocido no confirma, el enlace con token válido confirma (y repetirlo responde igual), un enlace vencido no confirma, el enlace de baja pide un clic y da de baja (omite el pendiente de la campaña) y la persona puede volver a suscribirse; un enlace de baja con forma inválida muestra «Enlace inválido» | MSF-978 (MSF-468 T032) | Escrito: `e2e/tienda-newsletter.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` por el filtro `e2e/tienda-`). No hay correo en el CI: el token lo genera el flow de Kestra y la base solo guarda su SHA-256, así que el test guarda por la REST (service-role, solo desde Node) el hash de un token propio. El stack del CI no corre funciones Edge: el test intercepta el pedido a `baja-correo-masivo` y reproduce lo que hace la función (SHA-256 y RPC `dar_de_baja_correo_masivo`). Datos únicos por corrida (correo con marca), limpieza en `afterAll`, y reinicia `tienda_envios` de la tienda para que el límite por visitante de otros specs no le quite cupo. Fuera: componer, previsualizar y enviar desde el panel, Kestra, el SMTP real y la Edge Function desplegada (`docs/newsletter.md`) |
| Actividad: detalle de un cambio de rol (Antes/Después) y de una baja con «—» del lado nuevo | MSF-170 (F-AUD-02) | Escrito: `e2e/actividad-detalle.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; el job `application` solo corre `acceso-publico`, así que no está verificado en el CI). Desvío: no se ejecutó (sin stack local). El E2E del acceso de soporte no se escribió: `service_role` no puede sembrar un superadmin |
| Clientes: la ficha muestra el «Saldo deudor» y la tabla «Cuenta corriente» con los comprobantes con saldo (F-CLI-19) | MSF-451 T005 | Escrito: `e2e/cuenta-corriente-cliente.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; aborta si `SUPABASE_URL` no es local; el job `application` solo corre `acceso-publico`, así que **no está verificado en el CI**). Usa el cliente 9100 del seed. Cobertura en el CI: pgTAP `cuenta_corriente_cliente` y Vitest de `ComprasCliente` |
| Clientes: alta, búsqueda y exportación a Excel (SC-001) | MSF-180 T017 | Escrito: `e2e/clientes-recorrido.e2e.ts` (Administrador: alta desde la UI, búsqueda por texto, exportación `.xlsx` cuyo contenido trae al cliente y evento `clientes.exportados` visible en Actividad; solo siembra organización, persona y rol, sin escritura directa en `clientes`). Evidencia: corrida verde del job `e2e-visible-sesion` (run 43731567956, job 132864939315). El job reserva ahora la ranura del stack (antes chocaba con `e2e-tienda` por nombre de contenedor en uso: corridas 43728936547 y 43730878020) |
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
| Consultas: la tienda envía por la RPC pública → aparece en la bandeja en menos de 5 s → el aviso queda encolado en `public.avisos_pendientes` para la persona de la organización → el detalle se abre desde el panel → asignar, anotar y resolver; Lectura solo ve, Mostrador no accede y otra organización no la ve (SC-004, SC-008) | MSF-548 T026 | Escrito: `e2e/consultas-recorrido.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No usa correo ni Edge Function: el aviso sale por la cola de plataforma (`private.emitir_aviso`), no por el camino directo que se retiró en MSF-853. Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase`, ver `docs/consultas.md` |
| Verificación manual 320/768/1440 px y lector de pantalla | MSF-125 T018 | Pendiente (manual) |
| Contacto de la tienda: datos de cada tienda, consulta que llega a la bandeja de su empresa con origen formulario, ráfaga de 6 envíos (el sexto muestra la espera, la bandeja recibe 5) y HTML literal (SC-004, SC-005) | MSF-437 T013 | Escrito: `e2e/tienda-contacto.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` del CI). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-contacto`. Restaura los datos de las empresas del seed y limpia consultas y envíos de prueba. Guía: `docs/tienda-contacto.md` |
| Consulta por WhatsApp desde la ficha: en las dos tiendas del seed, ficha → diálogo → «Abrir WhatsApp» (la URL de `wa.me` se verifica y la red no se toca) → la consulta llega a la bandeja de su empresa con origen whatsapp y el producto, y la empresa sin número no muestra el botón (SC-008) | MSF-433 T028 | Escrito: `e2e/tienda-whatsapp.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; corre en el job `e2e-tienda` del CI). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker ni al CLI de Supabase); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-whatsapp`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local. Guía: `docs/tienda-contacto.md` |
| Tienda pública: tras más de 12 h sin actividad, el primer clic del visitante NO cierra la sesión ni redirige a ninguna parte (la tienda no hereda la regla de inactividad del panel: su sesión termina por salida explícita o por el tope de 30 días del servidor) | MSF-740 | Escrito: `e2e/tienda-sesion-vencimiento.e2e.ts` (no necesita la base: adelanta la marca `sesion:ultima-actividad` 13 h con un init script y vigila que el visitante no salga de `/ingresar`, que no haya pedido a `/auth/v1/logout` (ni local ni global) y que no aparezca el 404 de `/login`; en local se omite si el build no define `VITE_PANEL_HOSTS`, porque entonces el host no se sirve como tienda; en el job `e2e-tienda` (`E2E_TIENDA_CI=1`) FALLA en vez de omitirse, para no dar un falso verde; en `application`, cuyo build no define `VITE_PANEL_HOSTS`, y en local se omite como antes). Antes (MSF-673, MSF-700) el caso afirmaba la vuelta a `/` de la tienda: esa expectativa quedó reemplazada por la decisión de MSF-740. La rama del panel (12 h → cierre y `/login`) la fija el Vitest `apps/web/src/lib/arranqueSesion.test.ts` |
| Lista de pedido sin cobro (B1, MSF-176): un visitante agrega 3 productos desde sus fichas, abre «Mi lista», la envía sin pagar y el operador la ve en Consultas como «Pedido» con los 3 ítems; el sexto envío de la hora muestra el aviso de límite y conserva la lista; almacenamiento bloqueado; bandera apagada = nada y `/lista` 404 (SC-002) | MSF-176 T043 | Escrito y verificado: `e2e/tienda-lista-pedido.e2e.ts` (**corrió de verdad en el job `e2e-tienda` y pasó los 3 casos**; corre en serie con un solo worker; el spec enciende la bandera global `tienda_pedidos` en `beforeAll` y la restaura en `afterAll`; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` o si la base aún no tiene las RPC de B1). Usa tienda, productos y persona del panel **propios de la corrida** (la baja de la organización se lleva todo), así el cupo de 5 envíos por hora no se comparte con otros specs. Las consultas entran solo por la RPC pública de la tienda (sin escritura directa en `dominio.consultas`). Guía: `docs/tienda-compra-y-cuentas.md` |
| Presupuesto desde la tienda (B2, MSF-176): el mayorista con cuenta activa pide el presupuesto desde su lista (cotización del servidor con escala x10, descuento de la ficha e IVA, «lo que ves es lo que se crea»); el operador lo ve «Pendiente» con operador «Tienda online (cliente)», lo acepta con el flujo actual y no hay stock ni cobros; el sexto del día muestra el aviso y conserva la lista; misma clave = mismo número; **dos llamadas simultáneas con 4 creados crean una**; sin cuenta, otra tienda, anónimo y bandera apagada = nada (SC-003, SC-005, SC-006) | MSF-176 T061 | Escrito: `e2e/tienda-presupuesto.e2e.ts` (corre en serie con un solo worker; enciende la bandera global `tienda_pedidos` en `beforeAll` y la restaura en `afterAll`; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` o si la base aún no tiene la tabla de B2). Usa tiendas, productos, clientes y persona del panel **propios de la corrida** (la baja de la organización se lleva todo), así el cupo de 5 envíos por hora y los topes por cuenta no se comparten con otros specs. El presupuesto entra solo por la RPC pública de la tienda (sin escritura directa en `dominio.comprobantes_venta` ni en `presupuestos_tienda`). Guía: `docs/tienda-compra-y-cuentas.md` |
| «Mi cuenta» de la tienda (F-CLI-20): sin sesión va a «Ingresar» con la ruta de vuelta, historial propio con estado público y total con IVA (nada de otro cliente), favoritos desde la ficha y desde «Mi cuenta», cuenta suspendida a mitad de la sesión y 200 comprobantes por tandas de 20 (SC-001, SC-006) | MSF-452 T022 | Escrito: `e2e/tienda-cuenta.e2e.ts` (corre en el job `e2e-tienda` con la bandera `tienda_pedidos` encendida por el propio spec; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` o si la base aún no tiene las RPC de la épica; con el SQL de la épica en la rama (PR #955, ya mergeado) corre de verdad en `e2e-tienda` y pasa; antes de eso sus omisiones rompían `e2e:omitidos:check --max=1`). La bandera `tienda_pedidos` es global: el spec la restaura en `afterAll`, pero si el proceso muere antes queda encendida en la base local. El producto de Favoritos tiene una imagen real en el bucket y el spec verifica que la miniatura carga. Los clientes se siembran como una persona del panel porque `service_role` no tiene grants sobre `dominio.clientes` en el stack del CI. Desvío: no se ejecutó en el entorno del Desarrollador (sin stack de Supabase local); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e tienda-cuenta`. Guía: `docs/tienda-compra-y-cuentas.md` |
| Toma de inventario: una categoría con 250 productos carga la tabla completa (250 filas con su stock en el sistema) y no aparece «No pudimos cargar los productos de esta categoría» (la URL del `in (…)` se parte en lotes) | MSF-716 FIX (F-STK-11 T014) | Escrito: `e2e/stock-toma-inventario-categorias.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e stock-toma-inventario-categorias`. Siembra organización, administrador, categoría y 250 productos, y limpia al final. Guía: `docs/stock-toma-inventario.md` |

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
- `e2e/panel-sin-desborde.e2e.ts`: `/productos`, `/clientes` y `/consultas` sin scroll horizontal de la página a 320, 375, 768,
  1280 y 1440 px, y axe a 320 px en esos listados, comprobantes, proveedores, presupuestos y con el menú lateral abierto, y a 768 y 1440 px
  en productos y consultas (MSF-595/MSF-611).
  Con sesión de administrador sembrada con la API admin; no deja datos.
- Los specs de la tienda (`tienda-*`) cambian el estado de la empresa (p. ej. `tienda-seo` la desactiva un momento) y
  comparten las dos tiendas del seed: correrlos con `--workers=1`.
- El build de la web lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (no `VITE_SUPABASE_ANON_KEY`); sin la
  clave la tienda muestra «No pudimos cargar esta página».

## CI

`validate.yml` corre los specs públicos como pasos del job de plataforma (después de
`pnpm build`: instala Chromium con `--with-deps` y ejecuta `pnpm --filter @platform/web exec playwright test acceso-publico.e2e.ts`; NO `pnpm test:e2e -- acceso-publico.e2e.ts`: el `--` llega literal a Playwright, que lo toma como fin de opciones y no filtra, así que corría los 103 specs).
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

El job `e2e-tienda` de `validate.yml` corre todos los `apps/web/e2e/tienda-*.e2e.ts` **y `apps/web/e2e/service-etiqueta-qr.e2e.ts`** (F-SVC-32, MSF-190: es el único E2E de Service que corre en el CI; el filtro de Playwright del paso es `e2e/tienda- e2e/service-etiqueta-qr`) en cada PR que toca la web, con la
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

Privilegios de `service_role` en `public` (hallazgo del primer CI real): `db:reset:ci` hace `drop schema public cascade` + `create schema public`,
lo que borra los privilegios POR DEFECTO que un Supabase da sobre `public` (ALL para `service_role` en toda tabla nueva). Una base de
desarrollo (`supabase start` + `migration up`, como la receta de arriba) los conserva, así que `tienda-analitica`, `tienda-promocion` y
`tienda-publicacion` pasaban en local y fallaban en el CI con `42501`. La migración `20270307100000` declara los grants mínimos
(solo `service_role`): `usuarios_organizacion` SELECT/DELETE, `usuario_empresa_activa` SELECT/INSERT/DELETE y `banderas_plataforma`
SELECT/UPDATE (pgTAP `service_role_grants_public_e2e`). Para reproducir el CI en local sin el job, aplicá el mismo SQL que
`scripts/reset-db-ci.mjs` (`sqlReset()` de `scripts/reset-db-ci-sql.mjs`, luego cada migración y `seed.sql` con `psql`) en lugar de
`migration up`; si un spec nuevo escribe una tabla de `public`, falla ahí con «GRANT ... TO service_role» y hay que declarar su grant.

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
- **Omisiones silenciosas.** En el CI un spec que se omite es un hueco, no un verde. Casi todos los specs de este job se omiten solos a
  nivel `describe` si faltan `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (y Playwright lo cuenta como éxito), así que el job
  corre al final `pnpm e2e:omitidos:check apps/web/resultado-e2e.json --max=1`: lee el reporte JSON de Playwright (reporter
  `json` con `CI`) y falla si hay más de un omitido (el único permitido es el de `tienda-seo` con `E2E_SIN_EDGE=1`) o si no
  corrió nada (`scripts/verificar-e2e-omitidos.mjs`; su test corre en `chequeos` con `pnpm test:e2e:omitidos`). Con
  `--permitidos=archivo.e2e.ts::fragmento del título` cada omitido tiene que SER el esperado (el archivo y el título coinciden): en `e2e-tienda`
  `tienda-seo.e2e.ts::robots.txt` y en `e2e-visible-sesion` `cuenta-web-cliente.e2e.ts::SC-006`; antes `--max=1` toleraba cualquier omitido.
  Además `tienda-sesion-vencimiento` falla (no se omite) en el job `e2e-tienda` (variable explícita `E2E_TIENDA_CI=1`, que solo setea ese job: en `application` el build no define `VITE_PANEL_HOSTS` y el spec se sigue omitiendo) si el build no sirve el host como tienda, y
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
### Estado del E2E con sesión en CI
- El job está **preparado** en `templates/calidad/e2e-sesion.job.yml` (kit) pero **no activo** en `validate.yml`.
- Bloqueo: `supabase start` con **kong/postgrest** falla porque postgrest arranca **antes** de que las
  migraciones creen el schema `dominio` (`schema "dominio" does not exist` → `/rest-admin/v1/ready`).
- Para activarlo: iniciar sin postgrest → `db:reset:ci` (crea `dominio`) → levantar postgrest después
  (o pre-crear el schema antes del start). Mientras tanto corre local/nightly; no se activa para no dar falsos verdes.

## Cobertura por historia con video (spec 022)

> **Privacidad del bucket `evidencias-e2e`**: su policy de lectura permite a cualquier usuario `authenticated`, de
> cualquier organización, listar y leer todos los videos. Los videos de evidencia no deben contener datos reales de
> clientes, solo siembras de prueba. En MSF no hay consumidor del visor (vive en el panel SDLC).

Cada test E2E declara qué cubre en su título con `[EPICA:TASK]` (la épica es la
clave MSF de Jira, el ítem es el Txxx del `tasks.md` de su spec):

```ts
test('[MSF-136:T021] entrada 10, salida 4 y ajuste …', async ({ browser }) => {
```

El visor **no vive en MSF**: es una pantalla del panel SDLC
(`http://<host-del-panel>:8098/?v=e2e`), que agrupa **Componente → Épica →
Historia** con progreso (`cubiertos / total` ítems, contando también los
`sin_cubrir`), buscador, filtro por estado, checklist y el video de cada test.

El panel importa la última corrida exitosa de este repo (botón «Importar
última» o automático cada 5 minutos), baja los artefactos y sirve los videos; no
hay bucket ni secretos en MSF. Desde la ficha de una épica se puede lanzar el
recorrido («Correr este recorrido»): el runner del panel dispara este workflow
con `e2e_grep=<clave>`, modo visible y video, y al terminar publica el video.

El componente se declara en el `spec.md`, junto a la épica de Jira:

```md
**Componente**: Acceso

**Jira Epic**: MSF-119 — Acceso, organización y permisos · Acceso y organización
```

En cada PR, el job `application` graba los E2E públicos y deja **un solo
comentario** (lo edita en cada push) con el link al visor, tomado de la variable
`EVIDENCIAS_E2E_VIEWER_URL`; sin esa variable o sin los secretos del bucket no
comenta y la corrida no falla. Tampoco falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): el paso lo detecta, avisa en el log y sigue.

Sin esa línea la épica cae en "Sin clasificar" (no se pierde ninguna historia).
El nombre visible de la épica sale de la línea `**Jira Epic**`: se muestra la
historia (lo que sigue al último `·`), no el código; la clave MSF queda en su chip.
Tanto la lista como la ficha intentan primero el bucket y, si no está
configurado, el manifiesto local `apps/web/public/cobertura-e2e.json` (útil para
probar el visor sin secretos); la lista lo marca con la insignia "Manifiesto local".

Pipeline:

1. La corrida E2E emite además el reporte JSON (`--reporter=json`,
   `PLAYWRIGHT_JSON_OUTPUT_NAME`): `validate.yml` lo genera en cada corrida web.
2. `pnpm cobertura:e2e -- --report <json> --results <test-results> --specs specs --out <cobertura.json> --run-id <id> [--modo on|retain]`
   Las claves del bucket se sanean a ASCII (`edición` → `edicion`): Storage
   rechaza nombres con acentos, y el manifiesto se reescribe con la misma clave
   para que el visor no pida una ruta inexistente.
   cruza títulos × `tasks.md` × videos y emite el manifiesto (evidencias,
   huérfanos sin etiqueta o con clave inexistente, e ítems sin cubrir).
3. El CI adjunta el manifiesto al artefacto `playwright-report` y, si existen
   los secretos `EVIDENCIAS_E2E_URL` / `EVIDENCIAS_E2E_SERVICE_ROLE_KEY`, lo sube
   junto a los videos al bucket privado `evidencias-e2e` (`<run-id>/…` más el
   puntero `latest/` que lee el visor). Sin secretos, la subida se omite sin
   fallar. Los videos se firman bajo demanda (URL firmada de 5 minutos); la
   ficha nunca descarga videos hasta pedirlos.

## La regla de un ítem: la descripción tiene que alcanzar (MSF-907)

El runner deriva de cada ítem de `tasks.md` tres cosas: **a qué historia pertenece**, **qué
criterios de aceptación** tiene y **cómo se describe** en la tarjeta del video. Las tres salen
del texto del ítem, y por eso el texto es un contrato: si no alcanza, el runner degrada en
silencio (evidencia sin criterios, ítem agrupado por tarea en vez de por historia, o un ítem
contado como «sólo base de datos» con lo cual nadie escribe el test).

La regla vive en un solo lugar —`scripts/historia-item.mjs`, que usan el manifiesto, el
ensamblador de videos y el reporte por épica— y dice:

- **El texto del ítem es completo**: incluye las líneas indentadas que siguen (notas, desvíos,
  un enunciado partido en dos).
- **El código de historia `F-XX-NN` se lee en cualquier posición**: `[P] [F-EMP-03][US1] …`
  cuenta igual que `[F-EMP-03][US1] …`.
- **Una descripción es utilizable** cuando tiene texto (para describirla) **y** código de
  historia (para unirla a sus escenarios). Si no, el runner lo dice:
  - el manifiesto publica la lista nueva `items_sin_descripcion` (con el motivo: `sin texto` o
    `sin historia`) y la línea de resumen la cuenta;
  - el reporte por épica (`scripts/e2e-cobertura-epicas.py`) tiene su propia columna «Ítems
    pendientes sin descripción» y **no** cuenta esos ítems como «sólo base de datos»;
  - el video de un ítem sin criterios se publica marcado «sin criterios» y su tarjeta
    muestra el id del ítem en vez de un subtítulo vacío.

Las dos claves del manifiesto son **aditivas**: el visor del panel SDLC las ignora hasta que
las consuma.

El manifiesto es un **registro**: lista todos los ítems sin descripción utilizable, hechos o
no (igual que `sin_cubrir`). El reporte por épica es una **cola de trabajo**: su columna
cuenta sólo los ítems **pendientes** (a un ítem ya hecho no hay que escribirle nada; los de
cierre y los de specs de plantilla no llevan código de historia por diseño).

El encabezado de la historia en el `spec.md` se lee en los dos formatos que usa el repo
(`### User Story N - … (F-XXX-NN, …)` y `### USN — … (F-XXX-NN, …)`) y el código puede ir
dentro del paréntesis con otros datos (`(MSF-383 · F-PRV-04, P0, talla L)`). Si dos historias
del mismo spec declaran el mismo código, el manifiesto lo publica en `historias_ambiguas` en
vez de elegir en silencio.

Para ver la cola de ítems que el runner **no** puede derivar, y correr las pruebas de la regla:

```bash
pnpm test:historia:item        # la regla compartida
pnpm test:e2e:cobertura:epicas # el reporte por épica (lee los ítems con esa misma regla)
python3 scripts/e2e-cobertura-epicas.py --epicas MSF-136   # o --md para markdown
```

## Estándar: toda prueba deja su video

Todo test E2E que pruebe una historia sigue tres reglas:

1. **Importa de `./fixture`**, nunca de `@playwright/test`: `import { expect, test } from './fixture'`.
   El fixture reemplaza `page` por una página que graba **siempre** a 1920×1080 y adjunta el video al reporte
   (el nativo de Playwright se reduce a 800×450). Si el test abre sus propias sesiones, usa
   `abrirContextoGrabado` / `cerrarContextoGrabado` (cerrar en el `finally`: el video también sirve cuando falla).
2. **Lleva `[EPICA:TASK]` en el título**: `test('[MSF-136:T021] …')`. Con eso `pnpm cobertura:e2e`
   ata el video a la historia (el Txxx de su `tasks.md`) y, por la clave MSF, a la épica; sin etiqueta queda
   como huérfano en el manifiesto.
3. **Narra con `paso(page, 'Qué hace', …)`** (`visible.ts`): con `E2E_VISIBLE=1` muestra cursor, clics y rótulos
   grandes (44 px); sin la variable no cambia nada.

Comando para generar el video de muestra: `pnpm test:e2e:evidencia` (= `E2E_VISIBLE=1 playwright test`;
con `E2E_BASE_URL` apunta a una web ya servida). El ejemplo de referencia es `e2e/evidencia.e2e.ts`.
Los videos quedan en `apps/web/test-results/<test>/attachments/` y siguen el flujo de «Cobertura por historia con video».

**Pendiente (anotado):** mostrar el video también a nivel **épica** en el visor del panel SDLC (hoy se agrupa
Componente → Épica → Historia y el video cuelga de la historia): una vista de la épica con el resumen de sus
recorridos y un único video de muestra (intro + clips de sus historias + cierre).

## Videos de prueba por funcionalidad, en ItsAPlan

Un video por **funcionalidad** (no uno por escenario, ni uno por épica): cada test agrupa los escenarios de
aceptación que son el mismo recorrido y los declara en el título.

```ts
test('[F-STK-02#1-4,8] el Operador registra entrada, salida y ajuste …', …)   // escenarios 1 a 4 y 8 de la historia F-STK-02
test('[F-STK-02#5] [F-STK-05#4] Consulta ve el stock sin poder registrar …', …) // un test puede cubrir varias historias
test('[MSF-136:T025] el Administrador agrega un motivo …', …)                  // sin escenario en el spec: por tarea
```

- `[F-XXX-NN#n]` apunta a los escenarios numerados de la historia en `spec.md` (`### User Story N - … (F-XXX-NN`
  o `### USN — … (F-XXX-NN`).
  `pnpm cobertura:e2e` los resuelve (`historia`, `criterios`) y lista en `criterios_sin_cubrir` los que ningún test cita.
- Lo que no tiene pantalla (RLS, concurrencia, escritura directa) queda en pgTAP y no necesita video.
- `pnpm armar-video:e2e` arma, **sin IA**, un MP4 1920×1080 por test: tarjeta de entrada con los escenarios que
  cubre, el recorrido narrado y tarjeta de resultado. Una tarea `[F-XXX-NN][US1]` cuelga de su historia.

```bash
pnpm cobertura:e2e -- --report e2e-report.json --results apps/web/test-results --specs specs --out cobertura.json --run-id local --modo on
pnpm armar-video:e2e -- --manifiesto cobertura.json --videos apps/web/test-results --out videos [--epica MSF-136]
ITSAPLAN_API_KEY=… pnpm armar-video:e2e -- --manifiesto cobertura.json --videos apps/web/test-results --out videos --publicar
```

Con `--publicar`: cada video se adjunta a la **historia** hija de la épica cuyo título menciona su clave
(`F-STK-02` o `Txxx`; si ninguna la menciona, a la épica), cada historia recibe un comentario con los links de
sus videos y la **épica** recibe un único comentario con los links de todos, agrupados por historia. Requiere
`ffmpeg` y el Chromium de Playwright; usa `ITSAPLAN_API_URL` (por defecto `https://api.plan.agenmatica.com`)
e `ITSAPLAN_API_KEY`.

Cuándo generarlos: solo para las épicas que pasan a Review In DEV o cuando cambia un test de la épica
(`tests-afectados.mjs` dice cuáles), con `E2E_VISIBLE=1`; la corrida normal de CI sigue sin cámara lenta.
Los E2E con sesión (`e2e/semillas.ts`) necesitan el Supabase local (`pnpm dev:supabase`).

## Recorrido visible (video para mirar)

Con `E2E_VISIBLE=1` (automático cuando el run manual lleva "Grabar video +
traza"), la suite se comporta como un recorrido guiado: viewport 1920×1080,
cámara lenta, cursor rojo gigante con onda en cada clic y un rótulo que narra
cada paso (`apps/web/e2e/visible.ts`, helpers `prepararPaginaVisible`/`paso`).
Sin la variable, `paso` ejecuta la acción sin tocar nada: los asserts y los
tiempos del CI no cambian.

Los videos quedan en `apps/web/test-results/<test>/video.webm` (uno por test,
con el rótulo quemado en la imagen) y viajan en el artefacto
`playwright-report`; el manifiesto `cobertura-e2e.json` los referencia por
historia para el visor del panel SDLC.

## Ver-para-aprobar sin descargar artefactos

1. **Panel SDLC** (`?v=e2e`): importa la última corrida y reproduce los videos
   por componente/épica/historia. Es la vía normal.
2. **Servidor local con tailnet**: tras una corrida local con video
   (`E2E_VIDEO=on E2E_VISIBLE=1 pnpm test:e2e`), publicar con
   `node scripts/publicar-videos-e2e.mjs --manifiesto <cobertura.json> --videos apps/web/test-results --run-id local`
   y abrir la URL `http://<ip-tailnet>:9324/<run-id>/` que imprime.
   (En el runner de CI no sirve: es un contenedor sin tailnet.)
3. **Artefacto** `playwright-report` del run: siempre disponible, retención 14 días.

## Recorrido público completo

`apps/web/e2e/recorrido-publico.e2e.ts` ([MSF-119:T020]) es el tour mir-able
de la parte pública: un solo test, un solo video. Abre `/`, `/stock`,
`/clientes` y `/empresas` sin sesión (todas piden ingresar), escribe un correo
en la recuperación (sin enviar nada) y recorre el caso de enlace vencido. Solo
navega y verifica textos: no toca el backend y corre en el CI público.

## E2E con sesión en CI (manual)

El job `e2e-visible-sesion` (solo `workflow_dispatch` con `e2e_sesion: true`)
levanta el stack Supabase del CI, lo resetea, buildea la app contra él y corre
los specs con sesión en modo visible (`permisos-por-empresa.e2e.ts`, que siembra
sus propios datos). Deja videos + manifiesto en el artefacto
`playwright-report-sesion`. Los runs de PR omiten estos specs (siguen con
`test.skip` sin `SUPABASE_URL`).

### Requisitos para armar/publicar los videos

- **ffmpeg con libx264**: el ensamblador arma el MP4 (tarjeta de intro + recorrido + cierre). El ffmpeg que
  trae Playwright es una build mínima (no sirve: no tiene `-preset`/libx264). En Linux:
  `apt-get install -y ffmpeg`.
- El **reporte JSON** de Playwright tiene que ser el de la corrida actual: si no se pasa
  `PLAYWRIGHT_JSON_OUTPUT_NAME`, el archivo `e2e-report.json` puede ser de una corrida vieja y los videos
  que se buscan no existen.
- Un test **omitido** (nunca se ejecutó) no tiene video: el manifiesto lo marca `omitido` y el ensamblador lo
  salta (no es un error).


---

## Receta A — dejar una HISTORIA con evidencia E2E (a mano)

Objetivo: que la historia quede con un **video** publicable. El pipeline ata el video a la historia por el
**rótulo del título del test**: `[MSF-<epica>:<TASK>]` (o `[F-XXX-NN#n]` para criterios sueltos).

### Qué necesitás
- La historia con su **código** (`F-XXX-NN`) y su **TASK** en el `tasks.md` de la épica
  (`specs/<slug>/tasks.md`, p.ej. `T020`).
- Un entorno donde corra la app (DEV: `https://dev.212-90-120-53.sslip.io`) o el stack local (Receta B).

### Pasos

1. **Creá el spec** `apps/web/e2e/<funcionalidad>.e2e.ts` a partir de la plantilla
   `apps/web/e2e/acceso-publico.e2e.ts` (copiá los imports y el `beforeEach`):

   ```ts
   import { expect, test } from './fixture'          // NUNCA de '@playwright/test': el fixture graba el video
   import { paso, prepararPaginaVisible } from './visible'

   test.describe('<Funcionalidad>', () => {
     test.beforeEach(async ({ page }) => { await prepararPaginaVisible(page) })

     test('[MSF-<epica>:T0yy] <qué hace>', async ({ page }) => {
       await paso(page, 'Abre /ruta', () => page.goto('/ruta'))
       await paso(page, 'Verifica X', async () => {
         await expect(page.getByRole('heading', { name: 'Titulo' })).toBeVisible()
       })
     })
   })
   ```

   - El **rótulo va en el TÍTULO del test** (es lo que lee el pipeline).
   - `paso()`/`rotulo()`/`clic()`/`escribir()` de `./visible` son los que hacen el video legible
     (cursor grande + rótulos). `clic`/`escribir` además anotan la pantalla.
   - Si el flujo necesita sesión/rol: `semillas.ts` (`sembrarStock`, `ingresar`) o el `storageState` de rol.

2. **Correlo con evidencia** (1920×1080, cursor y rótulos):

   ```bash
   cd apps/web
   E2E_BASE_URL=https://dev.212-90-120-53.sslip.io E2E_VIDEO=on npx playwright test e2e/<funcionalidad>.e2e.ts
   ```

   - En `apps/web/test-results/<test>/attachments/` queda el `.webm`.
   - Si lo vas a **publicar**, el reporte JSON tiene que ser de **esta** corrida:
     `PLAYWRIGHT_JSON_OUTPUT_NAME=/ruta/apps/web/e2e-report.json`.

3. **Armá el manifiesto y los MP4** (desde la raíz del repo):

   ```bash
   node scripts/cobertura-e2e.mjs \
     --report apps/web/e2e-report.json --results apps/web/test-results --specs specs \
     --out cobertura-e2e.json --run-id local --modo on
   node scripts/armar-video-evidencia.mjs \
     --manifiesto cobertura-e2e.json --videos apps/web/test-results --out videos
   ```

   - Sale un MP4 por funcionalidad, con tarjeta de intro y de cierre: `videos/<EPICA>-<TASK>-<n>.mp4`.
   - Necesita **ffmpeg con libx264** (`apt-get install -y ffmpeg`); el de Playwright es una build mínima.

4. **Publicá** (los videos se adjuntan a la historia/epica y se deja un comentario con los links):

   ```bash
   ITSAPLAN_API_KEY=… node scripts/armar-video-evidencia.mjs \
     --manifiesto cobertura-e2e.json --videos apps/web/test-results --out videos --publicar
   ```

### Qué probar (checklist) para darlo por bueno
- [ ] El test **pasa** (`npx playwright test` en verde) y el `.webm` existe en `test-results/`.
- [ ] El título del test empieza con `[MSF-<epica>:T0yy]` (o `[F-XXX-NN#n]`).
- [ ] `cobertura-e2e.json` lista la evidencia con `estado: "pasado"` y **no** aparece en `sin_cubrir`.
- [ ] El MP4 existe, se **reproduce** (intro + recorrido + cierre) y dura lo razonable.
- [ ] Tras `--publicar`, el issue tiene los `.mp4` adjuntos y el comentario con los links.

## Receta B — stack Supabase AISLADO para los E2E que siembran datos

Los tests que siembran (ej. `stock-historias.e2e.ts`) necesitan **base propia**: siembran filas y las borran.
Con **PRD/STG** no se toca nada: levantá un stack local.

### Pasos (en el nodo o en tu máquina, con Docker)

1. **Levantá el stack local** (el repo ya trae el CLI como devDependency):

   ```bash
   cd /ruta/del/repo
   pnpm dev:supabase            # = supabase start  (API en :9300, Studio en :4301)
   pnpm exec supabase status     # imprime anon key y SERVICE_ROLE key
   ```

   Los puertos están en `.env.example` (`SUPABASE_API_PORT=9300`, `SUPABASE_DB_PORT=7634`, …).

2. **Levantá la web** apuntando al stack local:

   ```bash
   cp apps/web/.env.example apps/web/.env    # y poné la ANON key que imprime `supabase status`
   pnpm --filter @platform/web dev            # http://127.0.0.1:4300
   ```

3. **Corré los E2E que siembran** (con las dos variables que el `semillas.ts` exige):

   ```bash
   cd apps/web
   SUPABASE_URL=http://127.0.0.1:9300 \
   SUPABASE_SERVICE_ROLE_KEY=<service_role de `supabase status`> \
   E2E_BASE_URL=http://127.0.0.1:4300 \
   E2E_VIDEO=on \
   npx playwright test e2e/stock-historias.e2e.ts
   ```

   - Sin esas dos variables el test se **omite** (no falla): por eso veías `9 skipped`.
   - Con elas, siembra lo suyo (`semillas.ts`) y corre.

4. Después seguí con los pasos 3 y 4 de la **Receta A** (manifiesto → MP4 → publicar).

### Qué probar (checklist)
- [ ] `pnpm exec supabase status` responde y la API `:9300` contesta.
- [ ] `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportadas → los tests **no** se omiten.
- [ ] El test pasa y deja su `.webm`.
- [ ] Las filas sembradas se **borran** al final (si no, la base local queda sucia: se reinicia el stack).
- [ ] El manifiesto los marca `pasado` y el MP4 se arma y se publica.


---

## Script: las dos recetas en un comando

`scripts/e2e-evidencia.sh` hace la Receta A y la Receta B de punta a punta (crear el spec, correr con video,
manifiesto, MP4 y publicar):

```bash
scripts/e2e-evidencia.sh checklist MSF-119        # qué falta para que la épica tenga evidencia
scripts/e2e-evidencia.sh epica MSF-119 T021 T022  # crea los spec base de esas tareas, corre y publica
scripts/e2e-evidencia.sh correr e2e/stock-historias.e2e.ts   # corre un spec y publica
scripts/e2e-evidencia.sh stack                    # Receta B: stack Supabase aislado + .env + claves
scripts/e2e-evidencia.sh publicar                 # sólo manifiesto + MP4 + publicar
```

- `epica` **reusa** el spec que ya tenga el rótulo (no crea otro) y, si falta, crea una **plantilla** por tarea
  (`[MSF-xxx:T0yy]` en el título + `fixture`/`visible`): hay que editarla antes de que la evidencia valga.
- Sin `ITSAPLAN_API_KEY` arma los MP4 pero **no publica** (y te dice el comando exacto para publicar).
- Necesita **Node ≥ 20**, `pnpm install` hecho y **ffmpeg con libx264**.
- Con `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportadas corren los tests que **siembran** (sin eso se
  omiten).

## E2E nocturno (`e2e-nocturno.yml`)

Decisión del gate MSF-852: la suite completa de Playwright (~100 tests, ~20 min en serie) corre en CI como un job
**nocturno** sobre `dokploy` y a pedido, y **NO bloquea PRs** ni merges. La decisión está implementada en
`.github/workflows/e2e-nocturno.yml`; para que el cron y el disparo manual existan, el archivo tiene que estar en la
rama por defecto (`main`), como se explica abajo.

**Cómo se reparten los E2E en el CI**

| Dónde | Qué corre | Bloquea |
|---|---|---|
| Cada PR (`validate.yml`, job `chequeos`) | Guardianes baratos: `pnpm e2e:escritura:check` y `pnpm test:e2e:escritura`, `pnpm test:e2e:omitidos` (el test de la guarda de omisiones; la guarda sobre el reporte JSON corre en `e2e-tienda`), `pnpm e2e:nocturno:check` y `pnpm test:e2e:nocturno` | Sí |
| Cada PR a `dokploy`/`main` que toca la web y no apunta a `epic/*` (`validate.yml`, job `application`) | Los specs públicos sin base (`acceso-publico`, `recorrido-publico`); el paso exige `changes.web` y `changes.e2e` en `true`, y `changes.e2e` es `false` en todo PR con base `epic/*` | Sí |
| Cada PR a `dokploy`/`main` que toca la web y no apunta a `epic/*` (`validate.yml`, job `e2e-tienda`) | Solo los E2E de la tienda pública (`tienda-*`) y, al final del job, `pnpm e2e:omitidos:check apps/web/resultado-e2e.json --max=1`; mismo requisito `changes.web` + `changes.e2e` | No, hasta que `E2E_TIENDA_BLOQUEA=true` |
| Todas las noches y a pedido (`e2e-nocturno.yml`) | La suite completa (`apps/web/e2e`, todos los specs) sobre `dokploy` | No: nunca bloquea; si falla, el run queda en rojo |

El nocturno usa la misma receta de stack que `e2e-tienda` (ranura del CI de `scripts/supabase-ci.mjs`, API por
`host.docker.internal`, sin Edge Runtime), así que lo que se aprende en uno vale para el otro.

- **Guarda del contrato:** `pnpm e2e:nocturno:check` (en `chequeos`, en cada PR) falla si el workflow deja de cumplir el
  contrato: el cron, el disparo manual, el kill switch del job (`vars.CI_PAUSED` y `vars.CI_E2E_NOCTURNO`), los permisos de
  solo lectura, el checkout de `dokploy`, Playwright en serie, el stack real de Supabase con sus migraciones, la guarda contra
  omisiones masivas del resumen, `continue-on-error` (dejaría el run verde con la suite omitida), o la aparición de
  `pull_request`/`pull_request_target` en cualquier forma YAML válida (bloque con cualquier indentación, lista o flujo).
  Cada marca tiene su test de mutación (`pnpm test:e2e:nocturno`).

- **Dónde tiene que vivir el archivo:** GitHub dispara `schedule` y resuelve `workflow_dispatch`/la API de Actions
  sólo en la rama por defecto (`main`). El workflow ya aterrizó en `main` con el PR #928 (commit `57ad76da`), así que
  el cron y el disparo manual existen; mientras vivía únicamente en `dokploy`, el cron no arrancaba y
  `gh workflow run e2e-nocturno.yml --ref dokploy` respondía `404` (no era un bug del job). Cada corrida hace
  `checkout` de `dokploy` (o de la rama del disparo manual), así que ejecuta el código y la suite de esa rama.
- **Cuándo corre:** todos los días a las 05:00 UTC (02:00 en Buenos Aires; Argentina es UTC-3 sin horario de verano) y
  por `workflow_dispatch`. El run siempre prueba `dokploy` cuando lo dispara el cron.
- **Dispararlo a mano:** Actions > «E2E nocturno» > «Run workflow», o `gh workflow run e2e-nocturno.yml`. Inputs opcionales:
  `spec` (uno o más archivos, separados por espacio, p. ej. `tienda-seo precios-iva`) y `grep` (solo los tests cuyo título
  coincida). Vacíos corre toda la suite. Un disparo manual desde otra rama prueba esa rama. Ejemplo:
  `gh workflow run e2e-nocturno.yml -f spec="precios-iva stock-movimientos"`.
- **Qué hace, en orden:** reserva una ranura del stack del CI (hasta 5 min de espera) y `db:ci:preparar` deriva su `project_id`
  `ci-*` y sus puertos (se edita una copia en `.supabase-ci/`, nunca `supabase/config.toml`); `SEGUIMIENTO_IP_SALT` va en
  `supabase/.env`; levanta `supabase start --ignore-health-check` con `kong`, `postgrest`, `auth`, `storage` y `realtime`
  (sin `studio`, `mailpit`, `imgproxy`, `logflare`, `vector`, `edge-runtime`, `supavisor` ni `postgres-meta`); `supabase migration up --local` aplica las migraciones y `seed.sql` se carga con `docker exec ... psql` (no `db:reset:ci`: recrea el esquema `public` y
  se pierden los privilegios por defecto de `service_role`, con lo que los specs que siembran en `public` fallan con «permission denied»); reinicia `supabase_rest_<project_id>` y espera a PostgREST, Auth, Storage y a las dos tiendas
  del seed; compila `workers/comprobantes-pdf` y la web (`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PANEL_HOSTS=localhost,127.0.0.1`);
  sirve la web con `vite preview --port 4300 --strictPort --host 0.0.0.0` y corre Playwright con `--workers=1 --retries=1`.
- **Puerto 4300:** lo exige `cuenta-web-cliente` (`site_url` de `supabase/config.toml`). Si está ocupado, el paso «Verificar que el
  puerto de la web (4300) esté libre» falla con un mensaje claro antes de levantar nada. La web corre dentro del contenedor del
  runner, donde el 4300 es propio.
- **Concurrencia y tiempo:** un solo run a la vez (`concurrency: e2e-nocturno`; el nuevo espera, no cancela) y tope de 45 minutos (ver abajo).
  No notifica a nadie ni abre issues.
- **Qué NO cubre:** sin Edge Runtime (el runner es docker-fuera-de-docker y `edge-runtime`/`functions serve` montan el directorio
  del checkout, que no existe en el Docker del host), por eso `E2E_SIN_EDGE=1`: `tienda-seo` (robots.txt y sitemap.xml), el caso
  «recuperar» de `cuenta-web-cliente` (excluido con `--grep-invert`: sin Edge falla siempre) y lo que dependa de funciones Edge o de Mailpit se omiten o fallan en el nocturno; siguen
  corriéndose a mano con las funciones servidas (ver «Specs que necesitan algo más que el stack mínimo»).
- **Cómo leer el resultado:** el resumen del run (`$GITHUB_STEP_SUMMARY`) trae una tabla con pasaron, fallaron, inestables (pasaron
  al reintentar) y omitidos, la lista de fallos con la primera línea del error y los omitidos por archivo. Si se omitió más de la
  mitad de los tests (por ejemplo, el stack sin `SUPABASE_URL`), el paso falla: un verde con todo omitido no vale. El artifact
  `e2e-nocturno` (7 días) trae `playwright-report` (HTML), `test-results` (trazas de los fallos; se abren con
  `pnpm --filter @platform/web exec playwright show-trace <traza.zip>`), el JSON de resultados y el log de vite. Si el resumen dice
  que no hay resultados, falló antes de Playwright: el paso en rojo del log dice cuál.
- **Limpieza:** el paso final (`always()`) mata `vite` y el puente por PID propio, baja el stack con `supabase stop --no-backup`, si
  algo quedó borra por la etiqueta del `project_id` de la ranura sus contenedores, volúmenes y red, y libera la ranura.
- **Memoria:** `vite` y Chromium corren dentro del runner (tope 3 GB y 2 CPU, `infra/runner/compose.yaml`); el stack corre en el
  Docker del host fuera de ese tope. Si el run muere por memoria, bajar réplicas del runner o subir `RUNNER_MEMORY_LIMIT`.
- **Apagarlo sin PR:** variable de repo `CI_E2E_NOCTURNO=false` (o `CI_PAUSED=true`, el kill switch de `validate.yml`): el job se
  saltea. Por ejemplo, `gh variable set CI_E2E_NOCTURNO --body false` y `gh variable delete CI_E2E_NOCTURNO` para volver a encenderlo.
- **Timeout 45 min y TTL de las ranuras:** quien reclama una ranura es quien recicla las vencidas. `e2e-tienda`,
  `database` y este workflow fijan `SUPABASE_CI_LOCK_TTL_MIN=75`, por encima del timeout del job. Por eso el nocturno
  dura como mucho 45 min desde que reclama y espera a lo sumo 5 min por una ranura (peor caso total 50). La suite entra
  holgada (setup ~6 min + ~21 min). La hora 05:00 UTC evita las 04:17 UTC, cuando corre el ci-janitor (`limpiar-ci`,
  TTL 90 min), que también limpia ranuras vencidas.

## Fixture compartido y corridas pendientes (lote MSF-879 / MSF-515)

- **Fixture compartido (MSF-856).** `apps/web/e2e/soporte/fixtures.ts` (`rest`, `leer`, `borrar`, `altaUsuario`,
  `borrarUsuario`, `cabeceras`, `limpiarOrganizacion`, `sql`) es la única fuente de la siembra. `service-cobro-avisos` la adopta
  (`tienda-publicacion` ya estaba en `dokploy`; este PR solo cambia el orden de lectura de la clave anónima) y **quedaron verificados con una corrida real del job `e2e-visible-sesion`**
  (`validate.yml`, `workflow_dispatch` con `e2e_sesion=true` y `e2e_archivos="service-cobro-avisos.e2e.ts tienda-publicacion.e2e.ts"`):
  run `43739671117`, job `132889822658`, **2 passed** (los dos tests se ejecutaron, ninguno omitido). Es una **corrida previa a la guarda de `sql()`**; la verificación con la guarda es el run `43746175251` (SHA `8295ee6`, job `132909861772`, **2 passed** en 53.8 s, ninguno omitido); un intento previo (`43743809263`) falló solo por pasar `e2e_archivos` separado por comas en vez de espacios.
  - Hallazgos de la verificación: (1) el CI exporta la clave anónima como `VITE_SUPABASE_PUBLISHABLE_KEY` (se lee primero);
    (2) `service_role` NO tiene grant sobre varias tablas de `public` (`features`, `organizaciones_features`, `conexiones`,
    `clientes`, `capacidades_ejecucion`, `avisos_pendientes`, `procesos_masivos`...): la API REST responde 42501. Sin migración,
    `service-cobro-avisos` siembra y lee esas tablas con `sql()` (Postgres directo, puerto EXPLÍCITO: `E2E_PGPORT` o el puente `SUPABASE_DB_PORT`, sin default;
    `pg` se carga del paquete del worker, como `ventas-impresion`). Siguen con copia propia `cuenta-web-cliente`, `exportacion-total`
    e `importaciones-soporte`, y `service-cobro-avisos` conserva un `leerDominio` local (su esquema por defecto es `dominio`).
  - **Límites de `sql()`:** corre como superusuario `postgres`, así que salta grants y RLS. Sirve solo para SEMBRAR, nunca para
    VERIFICAR (una lectura ahí no prueba lo que ve un rol real) y no sirve para tablas protegidas de solo lectura. La guarda
    `validarDestinoSql` (probada en `e2e/soporte/fixtures.test.ts`) exige host local, puerto explícito dentro de rango, que
    `E2E_PGPORT` y `SUPABASE_DB_PORT` coincidan si están ambos, que NO sea un puerto de `supabase/config.toml` (stacks de
    desarrollo, también reenviados), que `SUPABASE_CI_PROJECT_ID` y el puerto sean los del stack del CI derivado
    (`derivarStackCi`, como `verificarDestinoCi`), y base y usuario `postgres`. `validarUrlSupabase` aplica a `SUPABASE_URL`
    host local, puerto que no sea de desarrollo y, si el job declara `SUPABASE_CI_PROJECT_ID`, el puerto de la API derivada.
    Limitación: un stack local de `pnpm dev:supabase` (puertos de desarrollo) ya no sirve para `sql()`; hay que preparar el
    stack efímero con `pnpm db:ci:preparar`. La comprobación es de configuración, no inspecciona Docker. Riesgo residual
    conocido: cierra el error de escribir por descuido en el stack de desarrollo como superusuario, pero no impide escribir en
    OTRO stack efímero (variables `SUPABASE_CI_RANURA` o `GITHUB_REPOSITORY` falsificadas) ni en un túnel que alguien abra a
    propósito hacia un puerto derivado del CI (base 20000 más 6000 por ranura); eso exige intención activa. Endurecimiento posible, no aplicado:
    exigir `CI=true` o repetir el `docker ps --filter publish` de `verificarDestinoCi`. `pg` llega por
    `pnpm install --frozen-lockfile` de la raíz (el workspace incluye `workers/*`, que declara `pg` 8.23.1).
  - **Adopción en el resto de los specs (MSF-856, lote MSF-879).** Con `avisos-acceso`, `ordenes-compra` y
    `stock-toma-inventario-categorias` migrados, los specs con `rest` local son solo los de la lista siguiente; el resto de `e2e/`
    importa `rest`/`borrar`/`altaUsuario`... de `soporte/fixtures` (la cifra «~44 specs» del seguimiento ya estaba superada). Quedan
    con helpers propios, a propósito: `cabeceras` con perfil `dominio` por defecto y `actualizar`/`leer` de las tiendas (firma distinta:
    `tabla, filtro, cuerpo` o ruta con `accept-profile` por defecto); `precios-iva`/`stock-actual-vivo`/`ordenes-compra` (`modificar`/
    `actualizar`, PATCH que el fixture no ofrece); `ayuda`/`panel-sin-desborde` (`borrar` con URL completa); `ventas-faltantes-soporte`
    (`leer` con `dominio` por defecto, exportado a otros specs). Estos E2E los valida el CI (`e2e-visible-sesion`), no el entorno local.
  - **Migración de los que quedaban (lote 27).** `cuenta-web-cliente`, `exportacion-total`, `importaciones`, `importaciones-a11y`,
    `productos-create-permisos` y `notificaciones` ya usan el fixture compartido (`importaciones-soporte.ts` lo envuelve). Decisión
    sobre el grant de `service_role` (opción (b)): no se da por migración; lo que no tiene grant (`conexiones`, `capacidades_ejecucion`,
    `sistemas_externos`, `procesos_masivos`, `procesos_masivos_errores`, `avisos_pendientes`, `clientes_empresas`, `cuentas_cliente`) se
    siembra y se limpia con `sql()`. `cuenta-web-cliente` vincula la cuenta con la RPC `vincular_cuenta_cliente` (EXECUTE para
    `service_role`, `rest('rpc/…', cuerpo, 'public', 'return=minimal')`) y suspende con `sql()`; `altaUsuario(correo, null)` da de alta
    a la persona sin contraseña (invitación pendiente).
  - **Timeouts de 5 min de `exportacion-total`/`importaciones`/`importaciones-a11y` (causa probable, sin corrida local).** El CI
    no deja ninguna traza (el run `43736941987` no conserva artefactos) y el timeout no apunta a una línea: la config no fija
    `actionTimeout`, así que un `click`, `fill` o `boundingBox` sobre un elemento que no aparece espera hasta el tope del test en vez
    de fallar en segundos. Hipótesis adicional (sin medir): en modo visible cada tecla tipeada por `escribir` pagaría `delay` (90 ms) más el `slowMo` (350 ms),
    lo que haría lento cada ingreso (`exportacion-total` ingresa tres veces). Cambios: `ingresar` de `importaciones-soporte` llena con `fill`;
    los cinco specs fijan `test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 })` (un fallo real sale en 30 s señalando la
    acción); `sql()` fija `connectionTimeoutMillis`/`query_timeout`; todos los `fetch` del fixture (`rest`, `leer`, `borrar`, `altaUsuario`, `borrarUsuario`, RPC) y de `importaciones-soporte`/`cuenta-web-cliente` llevan `AbortSignal.timeout(TOPE_FETCH_MS)` (30 s).
    Sin aserciones quitadas. Si algún spec vuelve a agotar el tiempo, el mensaje ya dice en qué acción.
    **Verificado en sesión:** los seis specs pasan con el fixture compartido en una corrida `e2e_sesion` (run `45501580902`, 9 pasaron en
    3,4 min; el único omitido es el de recuperar contraseña de `cuenta-web-cliente`, permitido porque ese stack no sirve la Edge Function).
    Los topes de acción y de red de arriba se dejan: convierten un cuelgue futuro en un fallo de 30 s que señala la acción.
  - **Costos conocidos de este lote.** (1) `ingresar` de `importaciones-soporte` llena con `fill`: en los videos del modo visible ya no
    se ve el tecleo del correo y la clave (sí el cursor sobre «Ingresar»). (2) La clave de `importaciones-soporte` (`CONTRASENA_E2E`)
    es fija a propósito: `ayuda` y `panel-sin-desborde` dan de alta con ese literal y entran con su `ingresar`; son usuarios
    efímeros de un stack efímero. `cuenta-web-cliente` sí genera una clave aleatoria por corrida. (3) `anonKey` de ese archivo
    ahora lee primero `VITE_SUPABASE_PUBLISHABLE_KEY`, como el fixture: es intencional, porque el job `e2e-visible-sesion` solo exporta
    esa variable (no `SUPABASE_ANON_KEY`) y antes el login de la siembra salía con `apikey` vacío (401).
  - **Job de sesión con `--workers=2 --retries=0`.** `validate.yml` (`e2e-visible-sesion`) corre `playwright test --workers=2 --retries=0` y no un worker por
    spec (los reintentos duplican el tiempo de cada rojo y con 5 min por spec visible y 40 min de tope del job agotan el job): con el runner cargado, seis specs visibles a la vez (cursor, rótulos, `slowMo`, video 1080p) agotaron los timeouts de 3-5 min.
  - **`cuenta-web-cliente` en el job de sesión (4 de 4 en rojo).** Dos causas, ambas pre-existentes (el spec nunca se había corrido
    en sesión). (1) `ERR_CONNECTION_REFUSED` en `127.0.0.1:<api>`: GoTrue arma el `action_link` de `generate_link` con su URL
    externa y el navegador corre dentro del contenedor del runner, donde 127.0.0.1 es el propio contenedor y el puente de la API
    murió con su paso; `generarEnlace` reemplaza el origen del enlace por el de `SUPABASE_URL` (`host.docker.internal`). (2) Con eso
    el `verify` redirige bien a `mundojc.localhost:4300/definir-contrasena`, pero se servía el PANEL y no la TIENDA: el build del job
    de sesión no exportaba `VITE_PANEL_HOSTS` (sí `e2e-tienda`); ahora el paso «Exponer claves» exporta `VITE_PANEL_HOSTS=localhost,127.0.0.1`,
    igual que `e2e-tienda`. El redirect sigue necesitando el puerto 4300 de `site_url`/`additional_redirect_urls` de
    `supabase/config.toml` (el `WEB_PORT` que el job escribe en `GITHUB_ENV` no llega al proceso de ese mismo paso). Validado en
    sesión después (run `45501580902`, ver arriba).
  - **Estado de MSF-964/965/966 (histórico de ese lote; los seis specs pasaron juntos después en el run `45501580902`, con SC-006 omitido).** Corridas de sesión del lote: verdes `exportacion-total` + `importaciones-a11y` (run 44188166361),
    `e2e/importaciones` + `productos-create-permisos` (44191224534) y `cuenta-web-cliente` sola (44199070547: 3 pasan y SC-006 se
    omite, ver abajo; el test de ingresos tarda ~1 min y necesita el `setTimeout(180_000)`). `notificaciones` sigue en ROJO: falló por timeout en
    44193675064, 44205757225 (y el reintento previo 44195930872 pasó solo con reintentos, que el job ya no usa). Esa corrida es anterior a las correcciones
    de abajo, que la dejaron verde.
  - **`notificaciones`: dónde se iba el tiempo (traza del run 44205757225).** El recorrido y las aserciones terminan a ~106 s; los ~200 s
    restantes son `Close context` (40 s por contexto) y adjuntar el video 1080p de los 2 contextos en el host saturado: el cierre cuenta
    contra el timeout del test. Subir el timeout no lo arregla. Cambios: `E2E_VIDEO_CONTEXTOS` (`completa` por defecto = 1920x1080 como
    siempre, `baja` = 1280x720, `off`; valor inválido lanza error) en `abrirContextoGrabado`; el job de sesión usa `baja`; y la segunda
    sesión de `notificaciones` («otra persona») no graba (`{ video: 'off' }`). El timeout del spec vuelve a 180 s. Después pasó en sesión (run `45501580902`).
  - **SC-006 (recuperar) en el job de sesión: causa real y decisión.** La pantalla mostraba «No pudimos enviar el enlace ahora» porque
    `POST /functions/v1/recuperar-clave-cliente` devolvía 500 de Kong (`{"message":"An unexpected error occurred"}`, traza del run
    44185502449): el job levanta el stack con `-x studio,mailpit,imgproxy,logflare,vector,edge-runtime,…` (`validate.yml`, paso «Levantar
    el stack de Supabase del CI»), o sea SIN Edge Runtime ni Mailpit. Servida, la función responde 400 a un cuerpo vacío (`handler.ts:72-74`).
    El test omite SOLO si la sonda devuelve 404 o el 500 de Kong con ese cuerpo («no servida»); cualquier otro código distinto de 400
    FALLA mostrando el status. El motivo se imprime en el log (`[omitido] SC-006…`), queda como anotación `omitido` del reporte y el
    paso «Verificar que no haya omisiones inesperadas» del job (`verificar-e2e-omitidos.mjs --max=1`, que ahora imprime el motivo) tolera
    como máximo ese único omitido. Evidencia del skip: run 44199070547. No se habilitó Edge/SMTP en el job (cambia el stack compartido
    del CI sin poder probarlo): MSF-964 queda abierto para SC-006 hasta servir la función (`supabase functions serve` con
    `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`ALLOW_HTTP_REDIRECT=true`) y habilitar el correo local.
  - **Timeouts de 300 s en sesión visible (`exportacion-total`, `importaciones`, `importaciones-a11y`).** La hipótesis del
    `actionTimeout` quedó descartada: son del recorrido visible (slowMo 350 ms, cursor de 30 pasos hacia cada clic, rótulos de 2,2 s, video
    1080p) con el runner cargado. No se suben los timeouts. Se corre en grupos de 2 specs como máximo (input `e2e_archivos`), uno por
    corrida, p. ej. `gh workflow run validate.yml --ref <rama> -f e2e_sesion=true -f e2e_archivos="exportacion-total.e2e.ts importaciones.e2e.ts"`,
    luego `"importaciones-a11y.e2e.ts cuenta-web-cliente.e2e.ts"` y `"notificaciones.e2e.ts productos-create-permisos.e2e.ts"`. Bajo carga
    se puede bajar la cámara lenta con las variables `E2E_SLOWMO_MS` (por defecto 350, `playwright.config.ts`) y `E2E_MOUSE_PASOS` (por
    defecto 30, `visible.ts`); el job `e2e-visible-sesion` las exporta en 100 y 10 (host compartido y saturado), y el modo local/video conserva
    350 y 30.
  - Dos corridas previas (`43728936584`, `43730883232`) fallaron por infraestructura (el stack de la ranura compartida se pisó
    con otro run concurrente), no por los specs.
- **Estado de MSF-966, MSF-665 y MSF-773 en el lote 96 (sin stack de Supabase en esta máquina: nada de esto se ejecutó).**
  `productos-create-permisos` y `notificaciones` ya no dependen de grants a `service_role`: siembran y limpian lo que no tiene grant
  (`conexiones`, `avisos_pendientes`, `procesos_masivos`, etc.) con `sql()` de `soporte/fixtures.ts` (conexión admin de siembra,
  el patrón del repo) y no se amplió ningún grant; `pnpm e2e:escritura:check` pasa y `playwright test --list` carga los tres specs
  (`notificaciones`, `productos-create-permisos`, `ingresos-mercaderia-catalogo`). Falta la corrida en el job de sesión para dejar
  evidencia. El aviso de truncado del filtro de empresas del historial de ingresos ya existe (`HistorialIngresos.tsx`: pide 501 y avisa
  «Se muestran las primeras 500 tiendas; hay más.») con su prueba unitaria `HistorialIngresos.test.tsx`; el E2E del catálogo con 501
  productos reales (`ingresos-mercaderia-catalogo.e2e.ts`) queda listo y se corre con `gh workflow run validate.yml --ref <rama> -f e2e_sesion=true -f e2e_archivos=ingresos-mercaderia-catalogo.e2e.ts` (hay que pasar `e2e_archivos`: por defecto el job de sesión solo corre `permisos-por-empresa.e2e.ts`).
- **Pendientes sin ejecutar (MSF-665).** Siguen sin corrida con evidencia los recorridos «Pendiente» de la tabla de
  cobertura: usuarios (editar/suspender/reactivar), matriz de permisos, Empresas, editar la organización e ingreso con sesión y Catálogo (crear, editar, fotos y desactivar, SC-001/SC-006: no hay spec, falta el fixture por rol); Actividad con filtros ya tiene spec, MSF-879. Los de Inicio
  (tres roles y cambio de empresa) y Clientes (alta, búsqueda y exportación, SC-001) ya tienen su spec con corrida en
  verde. Los pendientes requieren specs nuevos y la corrida firmada por `e2e_sesion`.


## Perfiles de prueba: los crea la propia persona, no `service_role`

`service_role` tiene permisos mínimos por tabla y ninguna migración le concede `insert` sobre `public.perfiles_usuario`. Un spec que necesite un perfil (por ejemplo `permisos-por-empresa.e2e.ts`, que lo usa para que el listado de Usuarios muestre el nombre) inicia sesión como esa persona y lo inserta con su token, que es lo que permite la política `perfiles_usuario_insert_titular`. No se amplían permisos de `service_role` para los E2E. La clave anónima sale de `VITE_SUPABASE_PUBLISHABLE_KEY` (la que exporta el CI), con `SUPABASE_ANON_KEY` y `VITE_SUPABASE_ANON_KEY` como alternativas locales.

Nota de CI: el filtro `e2e_archivos=inicio.e2e.ts` también coincide con `tienda-inicio.e2e.ts`; para correr solo el de Inicio se pasa `e2e/inicio.e2e.ts`. El stack de CI es único por ranura: dos corridas simultáneas se pisan el reset de la base (síntomas: `relation ... does not exist` o `permission denied for schema dominio`); se reintenta con una sola corrida activa.

Confirmación de las esperas de «1 producto sin stock» en `e2e/inicio.e2e.ts` (Consulta, Mostrador y la persona de «empresa»): corrida 43745425878 de `validate.yml` (`e2e_sesion=true`, `e2e_archivos=e2e/inicio.e2e.ts`), job `e2e-visible-sesion` 132907556853, 2 passed (ninguno omitido). La corrida anterior con el filtro `inicio.e2e.ts` (43744514308, job 132904752661) también pasó los dos tests de Inicio y solo falló `tienda-inicio.e2e.ts`, que el filtro coincide por sufijo: usar siempre `e2e/inicio.e2e.ts`.

Reparación de `avisos-acceso`, `ordenes-compra` y confirmación en el CI (lote 7 de la deuda técnica): los tres specs con sesión venían rojos o solo parcialmente verdes en `dokploy` por causas del spec, no del producto. (1) `avisos-acceso` escribía `usuarios_empresas` con la service-role (403: `service_role` ya no la escribe): ahora el Administrador sembrado asigna la empresa al Operador con la RPC `asignar_empresas_usuario` (helper compartido `asignarEmpresasComoAdministrador` en `soporte/fixtures.ts`), que además fija la empresa activa del Operador. (2) `ordenes-compra` no elegía «Empresa de la compra»: con «Todas mis empresas» activa el alta no trae empresa por omisión y el envío se frenaba con «Elegí la empresa de la compra» (el producto está bien; la captura del fallo lo muestra), por eso nunca aparecía «Orden de compra creada»; el spec ahora elige la empresa en el diálogo, acota «Recibida» con `exact` (el detalle dice también «Recibida: <fecha>») y fija un `test.setTimeout` mayor porque en modo visible (slowMo 350 ms) el recorrido pasa del minuto por omisión. (3) `avisos-acceso` comprobaba que no aparece «Acceso restringido» con `getByText` por subcadena, que en modo visible también cuenta el rótulo narrado `#__e2e_rotulo`; ahora usa `exact`. Corrida manual de `validate.yml` (`e2e_sesion=true`, `e2e_archivos="avisos-acceso.e2e.ts ordenes-compra.e2e.ts stock-toma-inventario-categorias.e2e.ts"`) sobre la rama del lote: run 44012599213, job `e2e-visible-sesion` 133802910141, 3 passed (sin reintentos). Corridas previas del lote: 44009297220 (2 rojos por los dos últimos puntos) y 44011149553 (verde con 1 flaky de `ordenes-compra` por el tiempo del test).

E2E sin escritura directa con la service-role (lote 8 de la deuda técnica): `catalogo-productividad`, `consultas-recorrido` y `consultas-responder` también escribían `public.usuarios_empresas` con la service-role y fallaban con 403 (corrida base de `validate.yml` sobre `dokploy`, run 44015101592: los tres rojos con `REST usuarios_empresas: 403`; el otro test de `catalogo-productividad` pasó). Ahora cada uno siembra un Administrador de la organización y asigna las empresas con `asignarEmpresasComoAdministrador` del fixture (la RPC `asignar_empresas_usuario`); `inicio` deja de tener su copia del helper y usa la del fixture. Dos consecuencias de la RPC que el spec tiene que contemplar: (1) la RPC fija la empresa asignada como activa, y con una empresa activa el listado de Productos solo muestra los productos ya vinculados a ella; `catalogo-productividad` crea los 3 productos sin vínculo (lo que su última acción agrega) y por eso borra la fila de `usuario_empresa_activa` del Operador tras asignarle la empresa; (2) `public.avisos_pendientes` no se lee por la API (ni `service_role` ni `authenticated` tienen SELECT), así que `consultas-recorrido` ya no la consulta con la service-role: cada persona lee sus avisos con la RPC de la campanita, `listar_notificaciones`, desde su propia sesión (esa RPC además filtra por organización y por las secciones a las que la persona accede). Aserciones sin cambios. Corrida manual de `validate.yml` (`e2e_sesion=true`, `e2e_archivos="catalogo-productividad.e2e.ts consultas-recorrido.e2e.ts consultas-responder.e2e.ts"`) sobre la rama del lote: run 44020145323, job `e2e-visible-sesion` 133827430311, 3 passed y 1 flaky: `consultas-recorrido` falla en el primer intento por el tope de 5 s de la bandeja (SC-004: 10,9 s con los cuatro tests arrancando a la vez) y pasa en el reintento; el mismo primer intento lento se vio en las dos corridas previas del lote (44016435775 y 44017990513). Con `inicio` sumado (filtro `inicio.e2e.ts`, que además coincide con `tienda-inicio.e2e.ts`; mejor `e2e/inicio.e2e.ts`) la corrida 44017990513 corrió siete tests con seis workers y se saturó (reintentos y timeouts de 5 min también en `tienda-inicio` y en un test de `catalogo-productividad` que no se tocó); los dos tests de `inicio` pasaron en el reintento con el helper del fixture.

> Lote 99 (MSF-703/704): los workflows eligen su pool de runners por variable de repo (`CI_RUNS_ON_PR`, `CI_RUNS_ON_PESADO`, `CI_RUNS_ON_DEPLOY`), los binarios descargados (gitleaks, Supabase CLI) se instalan en `$RUNNER_TEMP/bin` con SHA256 verificado y release-please y el gate de staging abren un issue `alerta-ci` si fallan. Detalle y runbook: [endurecimiento-infra.md](endurecimiento-infra.md).
