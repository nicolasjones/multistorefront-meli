# Ventas · Listado de comprobantes y exportación

F-VTA-09 (MSF-346, épica MSF-177): buscar, filtrar y exportar facturas y notas de crédito. La pantalla
`/ventas/comprobantes` reemplaza la redirección al alta que existía hasta MSF-159.

## Pantalla

- **Menú** Ventas › **Comprobantes** (`ReceiptLongIcon`, sección `ventas`). Sin `ventas`, la ruta muestra
  «Acceso restringido». Las pestañas de la pantalla son **Comprobantes** y **Presupuestos**; Pagos,
  Faltantes, Devoluciones y Transportes son de otras épicas.
- **Encabezado**: «Comprobantes», el subtítulo del prototipo, **Exportar** (con la acción `exportar`) y
  **Nuevo comprobante** (con `ventas` en edición → `/ventas/comprobantes/nuevo`).
- **Filtros**: buscador «Buscar por cliente o número» (espera 300 ms), Operador, Estado, Pago y Envío con
  «Todos» y «Limpiar filtros» (solo con búsqueda o filtros de la fila). El filtro **Tienda** usa
  `FiltroEmpresa` («Todas las tiendas» + empresas accesibles): sigue a la empresa activa de la barra
  superior y, al cambiarla, la pantalla se remonta, vuelve a la página 1 y recarga todo (Principio VIII).
- **Tabla**: Comprobante (número + tipo, enlace a `/ventas/comprobantes/:id`), Tienda, Fecha, Cliente,
  Operador, Estado (chip del catálogo `estadosComprobante`), Pago, Envío y Total a la derecha, con fila
  resaltada en negativo para las notas. En pantallas angostas se muestran las mismas columnas en tarjetas.
  El contador dice «N comprobantes», la paginación es de 12 y el pie «1–12 de N».
- **Estados de la pantalla**: carga inicial, error con «Reintentar», «Sin resultados» con «Probá con otra
  búsqueda o limpiá los filtros.» y vacío real «Todavía no hay comprobantes.».
- Fuera de alcance (matriz pantalla↔criterios): tarjetas KPI, botón Imprimir por fila, letra A/B del
  comprobante y las pestañas de otras historias.

## Datos y RPC

Migraciones aditivas de F-VTA-09; la reversión está en el encabezado de cada archivo. No crean tablas:
solo funciones, un índice y el bucket de Storage.

| Objeto | Esquema | Acceso |
|---|---|---|
| `public.listar_comprobantes(...)` | `public` | `security invoker`, `authenticated`; página de facturas y notas con `filas` = total del filtro. |
| `public.operadores_de_comprobantes(uuid)` | `public` | `security invoker`; opciones del filtro Operador acotadas por tienda. |
| `public.exportar_comprobantes(text, ...)` | `public` | `security invoker`; todas las filas del filtro, tope 10.000; exige `ventas/exportar`. |
| `public.solicitar_exportacion_comprobantes(text, jsonb)` | `public` | `security definer`; registra la ejecución diferida y su orden de despacho. |
| `public.archivo_exportacion_comprobantes(uuid)` | `public` | `security definer`; solo el solicitante con `ventas/exportar` (si no, `42501`/`P0002`); ruta del CSV únicamente si la ejecución terminó `exitosa`. |
| `private.comprobantes_consulta(...)` | `private` | Consulta única compartida por listado, exportación y worker. Sin grant a `authenticated`. |
| `private.comprobantes_consulta_sesion(...)` | `private` | Puente de las RPC invoker: deriva organización y empresas del JWT, nunca de un argumento. |
| Bucket `exportaciones-ventas` | Storage | Privado; lectura solo para quien pidió, por prefijo `<organización>/<usuario>/`. Los CSV llevan nombres de clientes: al terminar una exportación el worker borra los CSV anteriores de ese usuario (queda solo el último; mejor esfuerzo, se reintenta en la próxima). Si el usuario no vuelve a exportar, su último archivo queda hasta que operación lo borre desde la API de Storage. |

Reglas del listado:

- Solo `factura` y `nota_credito`; los presupuestos tienen su pestaña y su propia exportación.
- La búsqueda compara por cliente o número sin mayúsculas ni tildes de vocales, recorta espacios y escapa
  `\`, `%` y `_`.
- Los filtros son Operador, Estado, Pago, Envío y tienda; `pendiente` y `confirmada` son equivalentes
  (`confirmada` se muestra «Pendiente»). El estado `vencido` de un presupuesto se deriva de `valido_hasta`.
- Orden estable: fecha descendente y, luego, número descendente. El total de una nota de crédito resta
  (signo negativo) cuando F-VTA-11 habilite `tipo = 'nota_credito'`.
- Solo entran las empresas donde la persona tiene `ventas` en lectura o edición; una empresa ajena
  devuelve cero filas.

## Exportación

- **Hasta 10.000 filas**: `exportar_comprobantes` devuelve todas las filas del filtro (no la página) y el
  navegador arma el CSV con separador `;`, BOM UTF-8 y CRLF para Excel. Reutiliza la neutralización de
  fórmulas de `exportarClientes.ts`. El botón está en Comprobantes y en Presupuestos, y no se ofrece sin la
  acción `exportar`.
- **Más de 10.000**: `solicitar_exportacion_comprobantes` guarda tipo, filtros y empresas visibles en una
  ejecución `manual` (`public.ejecuciones_worker`) y deja una orden en `public.despachos_ejecucion` para
  Kestra. Es idempotente con los mismos filtros y bloquea otra exportación simultánea del mismo usuario
  (`YA_EN_CURSO`). La pantalla avisa y ofrece **Descargar** en el mismo aviso: `public.archivo_exportacion_comprobantes(uuid)` devuelve el estado y, si terminó, la ruta del CSV, y la app firma una URL de 60 s del bucket `exportaciones-ventas`. No depende de «Ejecuciones» (vista de administrador que solo firma `evidencias-ejecuciones`). Si todavía se genera, avisa y se reintenta; si falló, lo dice.
- **Worker** `workers/exportar-comprobantes`: lee una ejecución por `ORGANIZACION_ID`/`EJECUCION_ID`,
  pagina con `private.filas_exportacion_comprobantes`, escribe el CSV una sola vez en el bucket (idempotente
  al reintentar) y cierra la ejecución con estado y error útil.
- **Kestra** `infra/kestra/flows/exportar-comprobantes.yml`: consume el outbox y lanza el worker con los
  reintentos del contrato. `pnpm infra:config` valida el Compose.
- El bucket es privado y solo lo lee quien pidió la exportación, de su organización y con `exportar`.

## Pruebas

- `supabase/tests/database/ventas_listado_exportacion.test.sql` (SC-001): búsqueda sin tildes y con
  comodines escapados, cada filtro, paginación y orden, tope 10.000, solicitud grande, `YA_EN_CURSO`,
  idempotencia, bucket, `security invoker`, `anon` sin ejecución y aislamiento por organización, empresa y
  sección.
- `apps/web/src/pages/ventas/comprobantes.test.tsx` (SC-002): columnas, búsqueda, filtros y «Limpiar
  filtros», vacío/sin resultados/error, tienda con empresa activa y cambio de empresa, exportación inmediata
  y diferida, «Sin resultados», sin permiso, acceso restringido, tarjetas en angosto y teclado.
- `apps/web/src/pages/ventas/presupuestos.test.tsx`: el botón Exportar de Presupuestos y su permiso.
- `workers/exportar-comprobantes/test/` (SC-003): CSV con filtros, separador/codificación, idempotencia,
  error útil y códigos de salida.
- Revisar también `pnpm ui:empresas:check`, `pnpm prototipo:check`, `pnpm matriz:check` y
  `pnpm infra:config`.

## Diferencias anotadas

- El prototipo muestra tarjetas KPI, impresión por fila y las pestañas Pagos/Faltantes/Devoluciones/
  Transportes. La matriz de la spec las declara fuera de alcance (MSF-195, MSF-213, MSF-135, MSF-178,
  MSF-139).
- `nota_credito` todavía no existe en el `CHECK` de `tipo`: lo agrega F-VTA-11. El listado y la exportación
  ya la contemplan (y restan su total) para no cambiar la pantalla al sumar esa historia.

## Endurecimiento de la exportación diferida (devolución PR #374)

- `private.capacidad_exportacion_comprobantes` ya no tiene grant a `authenticated`: solo la llama `solicitar_exportacion_comprobantes` (migración `20261212110400`).
- Esa función toma `pg_advisory_xact_lock` por usuario antes del control `YA_EN_CURSO`, así que dos pedidos simultáneos con filtros distintos se serializan.
- Si entre el listado y el clic el total pasa de 10.000, la vía inmediata (que corta en el tope) no baja un archivo recortado: pasa a la vía diferida.
