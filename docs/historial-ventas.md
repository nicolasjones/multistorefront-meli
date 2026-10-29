---
owner: producto
sources:
  - specs
---

# Historial de ventas importado (F-VTA-37 / MSF-293)

Archivo de consulta de las ventas, los cobros y las cotizaciones del dólar que
ocurrieron **antes** de la plataforma. Se importa una sola vez desde una
planilla `.csv` o `.xlsx` del panel anterior y desde ese momento es solo
lectura. No toca el stock ni los comprobantes vivos.

## Alcance

- Tres tablas en `dominio`: `historial_comprobantes`, `historial_cobros` y
  `historial_cotizaciones_dolar`.
- Bucket privado `historial-importaciones` con la planilla original.
- RPC `public.solicitar_importacion_historial(p_tipo, p_archivo)` y
  `public.historial_ultimo_numero(p_tipo, p_empresa_id)`.
- Worker `workers/historial-importador` y flow
  `infra/kestra/flows/historial-importador.yml`.
- Pantalla `/historial/importar` en `apps/web`.

## Permisos y RLS

- Leer el historial exige `ventas` en lectura o edición y una empresa
  accesible (las cotizaciones son globales de la organización).
- Importar exige `private.puede_escribir()` (administrador de la organización,
  o superadmin con organización activa). Es el mismo permiso que exige el
  bucket para subir y borrar: la pantalla borra la planilla solo si la RPC
  rechazó la solicitud (ninguna ejecución la referencia); una importación
  aceptada conserva el archivo como original auditado.
- `authenticated` no tiene insert/update/delete sobre las tablas: la única vía
  de escritura es `private.importar_historial_lote`, ejecutada por el worker.
- `anon` no tiene ningún privilegio.
- No hay FKs ni disparadores hacia tablas vivas: el historial no puede alterar
  comprobantes, cobros, stock ni saldos actuales (FR-008).

## Puesta en marcha de una organización

La ejecución cuelga de una conexión de plataforma, porque el ciclo de workers
necesita un servidor, una credencial y una capacidad auditables. El importador
no se conecta a ningún sistema externo real: la credencial es ficticia y solo
habilita la conexión.

1. Crear un servidor para la organización y su credencial SSH, como en
   cualquier worker del ciclo (`public.aprovisionar_servidor_organizacion`).
2. Crear la conexión del importador como administrador:

   ```sql
   select public.crear_conexion(
     '<organizacion_id>'::uuid,
     'historial-ventas',
     'credencial-ficticia-del-importador'
   );
   ```

   El catálogo `sistemas_externos` se entrega vacío: la entrada
   `historial-ventas` se carga sola al primer uso de la capacidad
   (`importar-historial-<tipo>`, que vence a la hora con `tiempo_max_seg =
   3600`).
3. En el host de despacho, `worker.env` debe definir, además de `PGHOST`,
   `PGPORT`, `PGDATABASE`, `PGUSER` y `PGPASSWORD`:
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY` (solo en el servidor, nunca en el navegador);
   - `WORKER_NETWORK=worker-egress-historial-ventas`.
   La red debe permitir la salida hacia Supabase. El flow rechaza cualquier
   otra red con «Red de egress no autorizada». `workers/egress-allowlists.json`
   no declara este worker: la red se crea a mano en el host (paso manual,
   igual que el resto de los workers hoy, cuyo `workers` está vacío).
4. Publicar la imagen del worker con el workflow de imágenes y fijar
   `HISTORIAL_IMPORTADOR_IMAGEN` (en local,
   `local/worker-historial-importador:latest`) en `infra/kestra/.env`.
5. Desplegar el flow `producto.ventas/historial-importador`. El `Schedule`
   reclama la outbox cada dos minutos; no hay webhook ni URL de despacho en la
   base.

El manifiesto y el lockfile fijan las dependencias del lector, parser y cliente
Postgres. TypeScript y Vitest conservan los rangos alineados con el workspace;
`syncpack` verifica esa coherencia.

## Mapeo de columnas

Los encabezados se comparan sin mayúsculas, tildes, espacios ni signos
(`numero de cliente`, `Número_de_Cliente` y `NUMERODECLIENTE` son la misma
columna); las columnas no reconocidas se ignoran. Las obligatorias se marcan
con `*`.

| Tipo | Columnas y alias aceptados |
| --- | --- |
| `comprobantes` | `Tienda`* (`empresa`, `sucursal`, `local`), `Tipo` (`tipo de comprobante`), `Comprobante`* (`numero`, `nro`, `numero de comprobante`), `Fecha`*, `Cliente`* (`nombre del cliente`, `razón social`), `Número de cliente` (`código de cliente`), `Operador` (`vendedor`, `usuario`), `Estado final` (`estado`), `Total`* (`importe total`) |
| `cobros` | `Tienda`*, `Fecha`*, `Comprobante`* (`número de comprobante`), `Cliente`*, `Número de cliente`, `Cuenta de cobro` (`cuenta`), `Aprobado por` (`aprobador`), `Importe`* (`monto`) |
| `cotizaciones` | `Fecha`*, `Dólar comprador`* (`comprador`, `compra`), `Dólar vendedor`* (`vendedor`, `venta`), `Cargó` (`cargado por`, `usuario`) |

Normalización:

- **Fecha**: `dd/mm/aaaa` (también con `-` o `.`), `aaaa-mm-dd` o la celda de
  fecha de Excel; se valida que exista en el calendario.
- **Importes**: coma o punto decimal; con ambos separadores manda el último.
  Con un solo punto, `1.234` es mil doscientos treinta y cuatro y `1.23` es uno
  con veintitrés. Se admiten `$`, `ARS` y `USD` como adorno. En cotizaciones el
  valor no puede ser negativo. Antes de escribir se rechazan valores que exceden
  la precisión de las columnas destino (`numeric(14,2)` o `numeric(14,4)`).
- **Tienda**: se compara con las empresas de la organización sin distinguir
  mayúsculas, tildes ni espacios; una tienda inexistente rechaza la fila (no se
  crean empresas).
- **Codificación y separador del CSV**: UTF-8 (con o sin BOM) o Windows-1252;
  separador `,`, `;`, tabulación o `|`.

## Consulta de ventas y cobros (F-VTA-38 / MSF-309)

Pantalla `/historial` (menú Ventas → **Historial**, icono de comprobante), de solo
lectura y con carga diferida. Protegida por la sección `ventas` (lectura o edición);
sin ese nivel muestra «Acceso restringido» y la entrada de menú no aparece.

- Pestañas **Ventas**, **Cobros** y **Cotizaciones del dólar** (esta última se
  completa en F-VTA-39, más abajo).
- RPC `public.listar_historial_ventas` y `public.listar_historial_cobros`
  (`security invoker`, `revoke … from public, anon`, `grant execute … to authenticated`):
  parámetros `p_busqueda`, `p_empresa_id`, `p_pagina`, `p_tamano` (tope 200), `p_desde` y
  `p_hasta`. Devuelven `total_filas` y el rango `fecha_desde`/`fecha_hasta` del filtro actual
  (los indicadores «Desde/Hasta»). Orden estable: fecha descendente, número descendente, id.
- La búsqueda es por cliente, número de cliente o número de comprobante, sin
  mayúsculas ni tildes y con el texto literal (`%` y `_` no son comodines).
- El filtro **Tienda** ofrece solo las empresas asignadas (`empresas_para_selector`); la
  base lo repite con `private.empresas_accesibles()` y la RLS de `historial_*`: una tienda
  ajena devuelve cero filas.
- Cada comprobante lleva el rótulo «Histórico» y conserva su número original; no hay
  acciones de edición, anulación, borrado ni exportación (el botón `Exportar` del prototipo
  queda fuera de alcance, ver la matriz de la spec).
- **Empresa activa (Constitución VIII)**: el filtro Tienda parte de la empresa activa de la
  barra superior (`useFiltroPorEmpresaActiva`, F-ROL-06); las píldoras de `FiltroEmpresa` la
  sobreescriben hasta que la activa cambie. Al cambiar de empresa o de organización la
  consulta se remonta: página 1, búsqueda vacía y recarga completa, sin filas de la anterior.
  Test: `list.test.tsx` («sigue a la empresa activa…»).
- Sin migración de tablas: las RPC son aditivas. Reversión (migración posterior):
  `drop function public.listar_historial_ventas(text, uuid, integer, integer, date, date);`
  y `drop function public.listar_historial_cobros(text, uuid, integer, integer, date, date);`.
- Pruebas: pgTAP `historial_listar_ventas_cobros.test.sql` y Vitest de
  `pages/historial/list.test.tsx` y `hooks/useHistorialVentasCobros.test.tsx`.

## Consulta de cotizaciones del dólar (F-VTA-39 / MSF-322)

Pestaña **Cotizaciones del dólar** de `/historial`, de solo lectura y con la misma
protección por sección `ventas` que Ventas y Cobros.

- RPC `public.listar_historial_cotizaciones(p_busqueda, p_pagina, p_tamano)`
  (`security invoker`, `revoke … from public, anon`, `grant execute … to authenticated`;
  tope 200 por página). Devuelve `total_filas`. Orden: fecha descendente, id.
  Reversión: `drop function public.listar_historial_cotizaciones(text, integer, integer);`
  en una migración posterior.
- **Globales de la organización**: sin `empresa_id`, sin filtro de tienda y sin depender de la
  empresa activa de la barra superior (por eso la pestaña solo se remonta al cambiar de
  organización). Rige la RLS de `historial_cotizaciones_dolar` (organización + nivel `ventas`).
- Columnas **Fecha**, **Dólar comprador**, **Dólar vendedor** y **Cargó**; buscador
  **«Buscar por fecha»** (`dd/mm/aaaa`, `aaaa-mm-dd` o una parte como `03/2020`, texto
  literal: `%` y `_` no son comodines), con espera al tipear y paginación en servidor.
  Estados de carga, error con «Reintentar», «Sin resultados» y vacío; tarjetas en angosto.
- No toca la cotización vigente de la plataforma.

## Revisión de seguridad del conjunto (cierre MSF-275)

Revisión manual de lo entregado en F-VTA-37/38/39, con las lentes `authz-security`,
`crypto-secrets` y `supply-chain-security`. Sin hallazgos que bloqueen.

- **Autorización (RLS/RPC)**: las tres tablas `dominio.historial_*` tienen RLS y solo
  `select` para `authenticated`; `anon` no tiene privilegios. Las RPC de lectura son
  `security invoker` con `search_path = ''`, `revoke … from public, anon` y grant explícito a
  `authenticated`: la organización sale de la sesión, nunca de un parámetro. Las funciones
  `security definer` (`private.*` del worker) se conceden solo a `workers_orquestacion` y
  `private.capacidad_importacion_historial` valida `puede_escribir()` antes de escribir.
- **Secretos y bucket**: `SUPABASE_SERVICE_ROLE_KEY` vive solo en el `worker.env` del
  servidor; el worker no la registra en logs y los rechazos no incluyen el valor de la
  celda. El bucket es privado, con políticas por prefijo de organización, solo
  `.csv`/`.xlsx`, tope de 50 MB y sin borrado del original de una ejecución creada.
- **Dependencias**: el worker usa `papaparse`, `read-excel-file` y `pg` con versiones
  exactas (`fflate` solo en pruebas). `pnpm audit --prod` informa 14 avisos, todos en `axios` y
  `follow-redirects` vía `apps/web › @nangohq/frontend` (spec de conexiones OAuth): ninguno
  alcanza al worker ni a este flujo. Corresponde a la spec de conexiones OAuth
  (seguimiento propio de esa spec); no se tocan dependencias ajenas a esta entrega.
- **Límite conocido**: la gestión de la conexión `historial-ventas` y del servidor es
  manual (ver «Puesta en marcha»); es un paso operativo, no una exposición.

## Flujo de una importación

1. La pantalla sube la planilla al bucket con la sesión del administrador, en
   la ruta `<organizacion_id>/<uuid>.<csv|xlsx>`.
2. `solicitar_importacion_historial` valida tipo, archivo y permiso, y crea en
   la misma transacción la ejecución `manual` y la orden de outbox.
3. El flow reclama solo las órdenes de capacidades `importar-historial-*`,
   resuelve el servidor de la organización y ejecuta el worker por SSH y
   Docker.
4. El worker descarga la planilla con la clave de servicio, valida **todas** las
   filas y, si hay un solo rechazo, no inserta nada. Si la planilla es válida,
   inserta por lotes de 1000 con `on conflict do nothing`.
5. Cierra la ejecución como `exitosa` (`IMPORTADAS:<n>`, detalle con `nuevas` y
   `existentes`) o `fallida` (detalle con total y hasta 100 rechazos: fila,
   columna y motivo). Los rechazos nunca incluyen el valor de la celda.
6. El flow confirma la orden; una falla no reintentable (código 78) la agota en
   el primer intento; una falla técnica la libera hasta 3 reclamos.

Reimportar la misma planilla es seguro: las claves naturales evitan duplicados
y las filas existentes se cuentan como `existentes`.

Límite conocido (FR-007): dos cobros idénticos del mismo comprobante, fecha e importe comparten
clave natural y el segundo se cuenta como `existente`; el origen no trae un identificador propio.

Seguridad: `iniciar_ejecucion_worker` acepta cualquier `detalle`, así que
`private.autorizar_worker_importacion` exige que `archivo` sea `<organizacion>/<nombre>.csv|xlsx`,
exista en el bucket `historial-importaciones` y pertenezca a la organización de la ejecución
(`CONFIGURACION_INVALIDA` si no). El worker repite el chequeo de prefijo antes de descargar.

`public.historial_ultimo_numero` devuelve el mayor número numérico histórico para
comprobantes o cobros (opcionalmente limitado a una tienda accesible). La RLS
determina qué organización y empresas puede consultar la sesión; los números
que no son dígitos se ordenan como texto.

## Errores que muestra la pantalla

| Código | Significado |
| --- | --- |
| `NO_AUTORIZADO` | El rol no puede importar en la organización. |
| `TIPO_INVALIDO` | El tipo no es `comprobantes`, `cobros` o `cotizaciones`. |
| `ARCHIVO_INVALIDO` | La planilla no está en el bucket de la organización o no es CSV/Excel. |
| `SIN_CONEXION_HISTORIAL` | Falta la conexión `historial-ventas` de la organización. |
| `YA_EN_CURSO` | Ya hay una importación de ese tipo en curso. |

La pantalla traduce esos códigos a mensajes accionables y nunca muestra el
error crudo del worker. El detalle completo queda en `/ejecuciones/<id>`.

## Validación

- `supabase/tests/database/historial_importacion.test.sql`: tablas, RLS, RPC,
  bucket y funciones del worker.
- `supabase/tests/database/historial_reclamo_despachos.test.sql`: el reclamo
  filtrado por capacidad no roba órdenes de otros flows y recupera reclamos
  vencidos.
- `apps/web/src/pages/historial/importar.test.tsx` y
  `apps/web/src/lib/historial.test.ts`: subida, estados, rechazos y acceso.
- `pnpm infra:config` valida el Compose de Kestra, no la sintaxis del flow.

## Reversión

Las migraciones son aditivas. Para deshacer la funcionalidad, en una migración
posterior y después de exportar los datos:

```sql
revoke execute on function private.reclamar_despachos_capacidad(text, integer, integer)
  from kestra_orquestacion;
drop function private.reclamar_despachos_capacidad(text, integer, integer);
drop function public.solicitar_importacion_historial(text, text);
drop function private.capacidad_importacion_historial(text);
drop table dominio.historial_cotizaciones_dolar;
drop table dominio.historial_cobros;
drop table dominio.historial_comprobantes;
```

Después, vaciar y quitar el bucket `historial-importaciones` desde la API de
Storage. Nunca en el mismo PR que crea las tablas.

## Notas operativas

- **Sin entrada de menú**: la pantalla es una herramienta puntual de
  migración; se llega desde el botón de Ejecuciones y no tiene icono propio en
  la navegación (excepción al Principio VI, aceptada para una pantalla
  transitoria).
- **Reintento tras fallo de cierre**: si `cerrar` falla después de insertar, el
  reintento encuentra todo como «existente» y el cierre reporta `nuevas=0`
  aunque se hayan cargado filas; el conteo de un reintento puede subestimar las
  nuevas.
- **Planillas grandes**: el límite de subida es 50 MB, pero un `.xlsx` se
  expande en memoria y el contenedor tiene 512 MB; una planilla enorme puede
  caer por memoria (137) y el flow la reintenta 3 veces sin éxito. Partir la
  planilla en varias.
- **Tiendas homónimas**: si dos empresas de la organización comparten nombre,
  la base toma la más antigua mientras el worker normaliza sin tildes ni
  signos; evitar nombres duplicados antes de importar.
- `private.reclamar_despachos_capacidad` resetea reclamos vencidos de todas las
  capacidades, no solo `importar-historial-*` (mismo comportamiento que la
  función genérica de spec 019).

## Notas de consulta (F-VTA-38)

- **Búsqueda sin índice trigram**: `listar_historial_ventas` y
  `listar_historial_cobros` filtran con `translate(lower(...)) like '%x%'` y
  calculan el total con `count(*) over ()`; cada página recorre todo el filtro.
  Volumen esperado: miles a pocas decenas de miles de filas por organización
  (planillas importadas de una tienda). Si el historial supera ~100 000 filas,
  agregar un índice `gin (... gin_trgm_ops)` sobre la expresión normalizada en
  una migración aditiva; hoy no se justifica sin un caso medido. Sin lote importado grande no hay tiempos reales que
  medir: la medición con `explain analyze` queda como criterio de reapertura (no como compromiso de este PR).
- **`visuallyHidden`**: `pages/historial/list.tsx` replica la constante local
  que ya usan Clientes, Proveedores y Ranking (no existe un helper compartido);
  el comentario `estilos-sueltos: ok` documenta la excepción a la regla de lint.
- **gitleaks en `reports/calidad.md`**: el escáner no corre en este entorno
  (sin binario y sin permiso sobre el socket de Docker), así que no hay salida
  reproducible. `gitleaks detect --no-git` escanea todo el árbol, no solo esta
  historia. Evidencia concreta:
  - Archivos de esta historia (`git diff --name-only` contra la épica): una
    búsqueda de `password|secret|token|api_key|service_role|eyJ…|BEGIN … PRIVATE`
    solo da `docs/historial-ventas.md:58,60` (nombres de variables
    `PGPASSWORD` y `SUPABASE_SERVICE_ROLE_KEY`, sin valores) y
    `reports/calidad.md:5` (la palabra «gitleaks»). Cero credenciales.
  - Hits probables del árbol completo, todos falsos positivos: contraseñas de
    fixtures de test (`apps/web/e2e/permisos-por-empresa.e2e.ts:12`,
    `stock-actual-vivo.e2e.ts:12`, `stock-concurrencia.e2e.ts:14`,
    `stock-movimientos.e2e.ts:12` = `Correcta-12345!`;
    `apps/web/src/lib/passwordPolicy.test.ts:23`;
    `pages/acceso/definir-contrasena.test.tsx:126,231`;
    `pages/cuenta/cambiar-contrasena.test.tsx:95,96`;
    `components/ReporteEmbebido.test.tsx:23` = `token-de-prueba`), ejemplos de
    documentación de skills (`.agents/skills/**`, `.claude/skills/**`) y las
    referencias `{{ envs.* }}` de los flows de Kestra (plantillas, no valores).
  - Para confirmarlo con el escáner real: `pnpm calidad` en el CI o en una
    máquina con Docker.
