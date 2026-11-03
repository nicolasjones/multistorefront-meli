---
owner: producto
sources:
  - scripts/demo-dataset
---

# Dataset de demostración (San Javucho y Mundo JC)

Datos de prueba completos y coherentes para **mostrarle el sistema al cliente**, revisar cada pantalla antes de la
demo y sacar las capturas de la documentación de usuario. Está basado en el rubro del cliente real
(sanjavucho.com.ar y mundojc.com.ar: repuestos y accesorios de videojuegos y consolas, venta minorista y
mayorista, service técnico, precios en USD). **Todo lo demás es ficticio**: personas, CUIT, CBU, teléfonos, correos
y proveedores son inventados (con dígito verificador válido donde el sistema lo valida).

Reemplaza al sandbox mínimo `pnpm demo:seed` (`scripts/demo-sandbox.mjs`, 3 clientes y 3 productos).

## Qué contiene

Una organización, **«San Javucho y Mundo JC (demo)»**, con 2 empresas y 7 usuarios (uno por rol):

| Módulo | Qué siembra |
|---|---|
| 01 · Organización | 2 empresas (San Javucho, CABA · Mundo JC, Córdoba) con razón social, CUIT, contacto y horarios; 7 usuarios con nombre y apellido y sus asignaciones por empresa; habilita la funcionalidad Service técnico (sin ella el Administrador ve la pantalla bloqueada) |
| 02 · Catálogo y precios | 8 proveedores; 28 categorías (raíces tomadas de los menús de los sitios del cliente) con su IVA; 99 productos con proveedor, código de barras, empresas y escalas x5/x10/x50; regla de precio por empresa (San Javucho 0 % con IVA, Mundo JC +8 % sin IVA); dólar de 1180 a 1420 en 12 cargas semanales confirmadas |
| 03 · Stock y compras | 4 depósitos (uno cerrado); stock inicial de 90 productos; 25 ingresos de mercadería en 88 días (3 anulados); 12 traslados; reservas del PS5 Pro (activas, descontadas, liberadas); toma de inventario; productos en cero, bajo mínimo y con exceso |
| 04 · Clientes y configuración comercial | 60 clientes de las 24 jurisdicciones (35 % mayoristas, 4 archivados, casos borde de datos); formas de pago y de envío por empresa, 7 transportes (5 con contrarreembolso), 4 cuentas de cobro; 12 cuentas web; 10 identificadores externos |
| 05 · Ventas, cobros, despacho y RMA | 158 comprobantes en 90 días (facturas, presupuestos vencidos y aceptados, 9 notas de crédito); cobros parciales y totales; deuda abierta; contrarreembolsos; faltantes de despacho; 10 RMA (las 5 formas × 3 estados); anulaciones; 25 impresiones |
| 06 · Service técnico | 27 modelos de equipo; 3 estados propios; 40 reparaciones en todos los estados (entregadas, anuladas, vencidas, re-ingreso por garantía) con ítems y costos |
| 07 · Tiendas online y consultas | Identidad visual distinta para cada tienda, textos, catálogo publicado (con categorías y productos ocultos), formas de envío, 5 estados de consulta; ~45 consultas de formulario y WhatsApp en ~58 días con responsables y notas; ~90 intereses de WhatsApp; avisos en todos los estados |
| 08 · Dólar de hoy | Una última cotización de **1.570** (valor de mercado del 31/10/2026: el blue y el MEP cerraron entre ~$1.565 y ~$1.574), cargada al final para que las ventas ya hechas conserven el dólar de su momento; recalcula los precios en pesos de los productos en USD |

Incluye **casos borde a propósito**: stock en cero, ventas con stock insuficiente rechazadas, clientes con deuda,
facturas en borrador abandonadas, presupuestos vencidos, ingresos anulados, reparaciones vencidas sin repuesto,
la tienda de Mundo JC con textos incompletos.

## Usuarios para la demo

Clave de todos: `Demo-Msf-2026!`. Correos `<usuario>@demo.msf.test`.

| Usuario | Rol | Empresas |
|---|---|---|
| `admin` | Administrador | todas |
| `operador` | Operador | ambas |
| `mostrador` | Mostrador | San Javucho |
| `deposito` | Depósito | ambas |
| `administracion` | Administración (cobranzas) | ambas |
| `tecnico` | Técnico | (ver limitaciones) |
| `consulta` | Consulta (solo lectura) | ambas |

## Cómo correrlo

El dataset se siembra **como usuarios reales por las RPC de la app**, no con inserciones directas: el esquema
`dominio` solo da permisos a `authenticated` (ni la service-role key escribe ahí). Por eso los datos quedan
consistentes y se genera la actividad. Lo que la API no permite (tiendas, fechas, contrarreembolsos) se hace en
pasos SQL con un rol que escriba en `dominio`.

Requisitos: Node 22, `psql` (o un comando equivalente) con un rol que escriba en `dominio`, y un Supabase con
**todas las migraciones aplicadas**. Con la CLI, `supabase start` puede no aplicarlas: corré también
`supabase migration up --local`.

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=...   # supabase status -o env
export SUPABASE_ANON_KEY=...
export DEMO_PSQL="psql postgresql://postgres:postgres@127.0.0.1:54322/postgres"   # o "docker exec -i <contenedor-db> psql -U postgres"

pnpm demo:dataset -- --reset     # borra la organización demo y la recrea completa (~1,5 min)
pnpm demo:dataset                # crea todo (falla si ya existe)
```

Variables opcionales: `DEMO_RUN` (cómo correr el runner Node; por defecto `node scripts/demo-dataset/index.mjs`),
`DEMO_ORGANIZACION` y `DEMO_SUFIJO` (organización paralela, p. ej. para desarrollar un módulo sin pisar la
principal: el sufijo se agrega a los correos, que son únicos en toda la instancia).

### Catálogo real del cliente (opcional)

Por defecto el dataset siembra un catálogo **ficticio** (99 productos) para que la demo no dependa de datos de
terceros. Con `DEMO_CSV_CLIENTE` se siembra el **catálogo real** que exporta el panel del cliente
(«PRECIOS SANJAVUCHO - productos web»): sus productos, precios en pesos, stock, destacados y árbol de
categorías tal cual (173 categorías de tres niveles: raíz, subcategoría y sub subcategoría).

```bash
export DEMO_CSV_CLIENTE="/ruta/al/CSV de precios.csv"   # el archivo del cliente (no se commitea)
export DEMO_IMAGENES_JSON=/tmp/demo-imagenes.json        # fotos ya subidas al bucket (opcional)
pnpm demo:dataset -- --reset
```

- El archivo del panel **no es un CSV válido**: cada fila termina en `;;;;;;`, la columna «Descripción» trae
  saltos de línea y comillas sin cerrar y algunos nombres traen comas. El lector (`lib/csvCliente.mjs`) ancla
  cada registro por el código y arma la cabeza (código, nombre, precios, stock, ids) y la cola (imágenes,
  video, destacado, código de barras, categorías) por su forma, sin renombrar ni aplanar las categorías.
- Los productos se crean con `moneda = 'ARS'`: la tienda muestra exactamente el número del Excel, sin depender
  de la cotización del dólar. Los proveedores (CUIT) y los impuestos por categoría son inventados, como en el
  catálogo ficticio.
- Las fotos del cliente están en `sanjavucho.com.ar/uploads/…` (el CSV trae la ruta vieja `/panel/uploads/…`).
  El bucket de la tienda firma URLs contra `productos-imagenes`, así que hay que bajarlas y subirlas
  (`scripts/demo-dataset/bajar-imagenes.mjs`) y pasar el mapeo con `DEMO_IMAGENES_JSON`.

### Un módulo suelto

```bash
node scripts/demo-dataset/index.mjs --listar
node scripts/demo-dataset/index.mjs --solo=05        # solo ese módulo, sobre una organización ya sembrada
node scripts/demo-dataset/index.mjs --desde=03       # del 03 en adelante (también --hasta=02)
```

Los módulos no son idempotentes: para repetir uno hay que hacer `--reset` completo.

## Capturas para la documentación de usuario

Con el dataset cargado, los specs de `apps/web/e2e/capturas/*.capturas.ts` recorren las pantallas y guardan los PNG que
ilustran el manual de usuario (`docs/producto/img/<página>/NN-descripcion.png` en la rama de documentación). Son de
**solo lectura**: abren y completan formularios y diálogos pero nunca los confirman, así que no modifican datos.

```bash
# la web apuntando al Supabase con el dataset, p. ej. en http://localhost:4300
export E2E_BASE_URL=http://localhost:4300 SUPABASE_URL=... SUPABASE_ANON_KEY=...
export CAPTURAS_DESTINO=/ruta/a/docs/producto/img      # por defecto docs/producto/img
pnpm docs:capturas                                     # todos los specs
pnpm docs:capturas 20-ventas                           # solo uno
```

`e2e/capturas/lib.ts` trae los helpers: ingreso por rol (`ingresar`), recuadros rojos con número de paso (`resaltar`),
`ocultar` para esconder textos internos que no deben verse en un manual, y `leer` para resolver ids como el propio
usuario. Config aparte (`playwright.capturas.config.ts`): no corre con `pnpm test:e2e` ni en el CI.

## Cargarlo en dev o en stg (guardado para cuando se quiera)

El dataset ya está armado y versionado: no hay que rehacerlo. Para sembrar un entorno compartido, en este orden:

1. **Migraciones al día.** El entorno tiene que tener todas las migraciones de la rama que se despliega (dev = `dokploy`).
   **stg todavía no las tiene** (sigue `main`, con muchas menos) hasta resolver la divergencia MSF-590: sembrar stg antes
   de eso falla en los primeros módulos.
2. **Acceso de base.** Hace falta un `psql` con rol `postgres` contra la base del entorno (para tiendas, fechas,
   contrarreembolsos e impresiones). Ejemplos: `DEMO_PSQL="ssh <nodo> docker exec -i <contenedor-db> psql -U postgres"` o un
   túnel al puerto de la base.
3. **Variables.** `SUPABASE_URL` (la API del entorno), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` y
   `DEMO_HOSTS_PERMITIDOS=<host del entorno>`: sin esa lista el runner se niega a tocar un host que no sea local.
4. **Correr.** `pnpm demo:dataset -- --reset` (~1,5 min). Es **idempotente**: el `--reset` borra solo la organización
   «San Javucho y Mundo JC (demo)» y la recrea; no toca otras organizaciones.
5. **Ver lo que dejó.** Usuarios `<rol>@demo.msf.test` con la clave `Demo-Msf-2026!` (ver «Usuarios para la demo»). Dólar
   en 1570 (módulo 08; cambiá `DOLAR_ACTUAL` si el valor de referencia es otro). Las capturas del manual se rehacen contra
   el mismo entorno con `pnpm docs:capturas` (ver más abajo).

Para tener la demo **aparte de los datos reales** del entorno, usá una organización paralela (`DEMO_ORGANIZACION` y
`DEMO_SUFIJO`): así los correos no chocan con los de otras organizaciones.

### Qué hace falta en un entorno compartido (permisos y desvíos)

El dataset está pensado para correr contra cualquier entorno, pero en los compartidos hay dos cosas que en el stack
local no aparecen:

1. **La service-role tiene menos permisos que en el stack local.** Ahí el CLI deja a `service_role` con todos los
   permisos sobre `public`; en dev (y stg/prd) los permisos son los de las migraciones: puede insertar en
   `public.organizaciones` y `public.usuarios_organizacion` pero **no leer** `usuarios_organizacion`, ni insertar ni
   leer `public.features` / `public.organizaciones_features`. Por eso:
   - el alta de membresías se hace sin pedir el `RETURNING` (`insertar(..., { devolver: false })`);
   - la funcionalidad «service técnico» se habilita por SQL (`sql/02-funcionalidad.sql`): la RPC
     `public.habilitar_feature` exige ser superadmin de plataforma;
   - los motivos de movimiento se completan por SQL (`sql/03-motivos.sql`): los crea el trigger de alta de
     organización, pero esa función puede haber quedado con la versión anterior (sin «Carga inicial de stock», que
     exige la RPC `aplicar_carga_inicial_stock`).
2. **El esquema `publico` tiene que estar expuesto en la API.** Las funciones públicas de la tienda online viven en
   `publico` (MSF-241): si el contenedor de PostgREST del entorno no lo tiene en `PGRST_DB_SCHEMAS`, la API responde
   «Invalid schema: publico» (406) y no se pueden sembrar las consultas que llegan por el formulario ni por WhatsApp.
   En el `config.toml` del stack ya figura (`schemas = ["public", "graphql_public", "dominio", "publico"]`), pero un
   contenedor que quedó corriendo con la lista anterior hay que recrearlo.

Además, si el entorno quedó con **funciones duplicadas de migraciones viejas** (mismo nombre, firmas distintas),
PostgREST no puede resolver la llamada («function … is not unique»). Es el desvío de versionado de migraciones
(MSF-590): las firmas viejas se borran con los `drop function` que ya traen las migraciones de la rama.

### Las tiendas online del demo y su dominio

Las dos tiendas del dataset (San Javucho y Mundo JC) se sirven como sitios públicos, resueltos por **dominio**:
el front decide «panel o tienda» comparando el host de la petición con `VITE_PANEL_HOSTS` (build arg del Dockerfile).
Sin esa variable el build **falla seguro**: todo host sirve el panel y no hay ninguna tienda.

Para mostrarlas desde internet hace falta, entonces:

1. **`VITE_PANEL_HOSTS` con el host del panel** del entorno (en dev: `dev.212-90-120-53.sslip.io`). Se compila
   con la imagen, así que hay que redesplegar la app.
2. **Que Traefik envíe esos hosts a la app**: los dominios de tienda no son los del panel, así que necesitan su
   propio router (en dev, `/etc/dokploy/traefik/dynamic/demo-tiendas.yml`, un archivo del provider `file` que
   Dokploy no regenera y sobrevive a los deploys).
3. **El dominio de la tienda en la base** tiene que ser ese host: `dominio.tiendas.dominio`. El dataset lo toma de
   `DEMO_DOMINIO_BASE` (por defecto `localhost`, que resuelve a 127.0.0.1 y no sale a internet; en dev,
   `212-90-120-53.sslip.io`, que sslip.io resuelve a la IP del VPS).

Con eso, en dev: `https://demo-sanjavucho.212-90-120-53.sslip.io` y `https://demo-mundojc.212-90-120-53.sslip.io`
son las tiendas del demo, alcanzables desde cualquier equipo.

**En dev, la imagen con `VITE_PANEL_HOSTS` se construye aparte** (`/root/build-tiendas-dev.sh` en VPS2): Dokploy
pasa el env de la app al contenedor pero **no al `docker build`**, así que el `ARG VITE_PANEL_HOSTS` del Dockerfile
llega vacío y el bundle sale con la lista de hosts del panel vacía (todo host sirve el panel). La imagen propia
`msf-app-tiendas:dev` es la que atiende los hosts de tienda (Traefik: `/etc/dokploy/traefik/dynamic/demo-tiendas.yml`);
el panel sigue en la app de Dokploy (`dev.212-90-120-53.sslip.io`). Cuando Dokploy pase ese ARG al build, se puede
volver a apuntar Traefik a `http://app-input-open-source-system-i3pt15:80`.

### En dev (VPS2) ya está sembrado

En dev el dataset quedó cargado (2026-11-02) y hay dos scripts en el servidor que lo dejan a mano:

| Script | Qué hace |
|---|---|
| `/root/cargar-demo-dev.sh` | borra la organización demo de dev y la vuelve a crear completa (~4 min). `--sin-reset` no borra antes; `--org` y `--sufijo` cargan una organización paralela |
| `/root/borrar-demo-dev.sh` | borra la organización demo de dev cuando se quiera. `--simular` muestra qué se borra sin borrar; `--si` no pregunta; `--forzar` saltea la validación de que el nombre parezca demo |
| `/root/mi-org-dev.sh` | mueve tu propia cuenta de dev entre la organización demo y la que tenías (`demo`, `sanjavucho`, `estado`) |

Los dos primeros leen la configuración de `/root/demo-dev.env` (API, base, claves) y usan el dataset de este repo.

**Ojo con la organización de trabajo:** la app trabaja sobre la organización de tu membresía
(`private.organizacion_id()` prioriza la membresía propia del superadmin), así que con una cuenta que ya es
miembro de otra organización no se ve el dataset: hay que entrar con un usuario del demo
(`admin@demo.msf.test` / `Demo-Msf-2026!`) o mover la membresión con `/root/mi-org-dev.sh`. Un usuario tiene una sola
membresía (la clave primaria de `public.usuarios_organizacion` es el `user_id`), así que no puede estar en dos
organizaciones a la vez.


## Seguridad

- El runner **aborta** si `SUPABASE_URL` no es local (`localhost`, `127.0.0.1`, `host.docker.internal`) y el host no
  figura en `DEMO_HOSTS_PERMITIDOS` (lista separada por comas). Sembrar un entorno compartido (p. ej. el dev) es una
  decisión explícita, nunca un efecto de olvidarse una variable.
- La service-role key solo se usa para Auth (alta de usuarios) y para la organización; nunca va a un navegador.
- El borrado (`sql/00-borrar-organizacion.sql`) actúa solo sobre la organización con el nombre indicado.

## Estructura

```
scripts/demo-dataset/
  demo.sh                 orquesta los pasos Node y SQL en orden
  index.mjs               runner de módulos (--solo, --desde, --hasta, --reset, --listar)
  lib/                    cliente HTTP, azar con semilla, fechas relativas, CUIT/EAN válidos, carga de contexto
  datos/                  datos de cada módulo (catálogo, clientes, ventas…)
  modulos/NN-*.mjs        módulos de siembra por RPC
  sql/00-borrar-organizacion.sql   reset completo (FK RESTRICT, triggers de inmutabilidad, huérfanos)
  sql/01-tiendas.sql      alta de las tiendas (dominio.tiendas la carga el equipo técnico por SQL)
  sql/02-funcionalidad.sql  habilita «service técnico» para la organización demo (la RPC exige superadmin)
  sql/03-motivos.sql      completa los motivos de movimiento de la organización demo
  sql/9N-*.sql            pasos finales (consultas con fechas, contrarreembolsos e impresiones, fechas)
```

Es **determinista**: usa un generador con semilla fija y fechas relativas a hoy, así que cada corrida produce el
mismo dataset sin envejecer.

## Qué no se siembra (y por qué)

- **Presupuestos «convertidos»:** no existe una RPC de conversión; los aceptados tienen su factura pero sin vínculo.
- **Avisos de reposición y de faltantes por correo:** sus RPC son solo de `service_role`, sin acceso a `dominio`.
- **Condición de IVA de los clientes:** la columna no tiene vía de carga por la API.
- **Logo y banners de las tiendas** y las **imágenes de los productos**.
- **Rol técnico:** no se le puede asignar ninguna tienda, así que no opera en Service; el trabajo del taller lo
  registra el operador y el técnico figura como responsable de la reparación.
- **Reparaciones que descuentan stock:** desde la migración 20270201200112 (F-SVC-12) el ítem de repuesto se descuenta
  del depósito o, si no hay stock, se carga igual y queda «pendiente». El dataset usa esa vía (`p_dejar_pendiente`).

## Cómo agregar un módulo

1. Crear `modulos/NN-nombre.mjs` con `export const nombre` y `export async function sembrar(ctx)`.
2. Escribir siempre como un usuario real (`const s = await ctx.sesion('operador')`) por RPC (`s.rpc`) o por RLS;
   usar `ctx.azar` (nunca `Math.random`) y las fechas de `lib/fechas.mjs`.
3. Si algo no se puede por API, un paso `sql/9N-*.sql` parametrizado con `:'org'`, idempotente y con el porqué en el
   encabezado.
4. Que `--reset` siga funcionando: el reset borra por SQL todas las tablas con `organizacion_id` y limpia las hijas
   huérfanas, pero una tabla nueva con FK fuera de `public`/`dominio` hay que revisarla.
5. Registrar acá lo que siembra.
