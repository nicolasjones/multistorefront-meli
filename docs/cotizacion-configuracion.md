# Configuración de la cotización (F-PRE-06)

Historia F-PRE-06 (MSF-419) de la épica MSF-352 (`specs/20270105-100000-configuracion-dolar-y-precio-propio/`).
Continúa [cotizacion-recalculo.md](cotizacion-recalculo.md): lo que antes eran valores fijos del lanzamiento
(umbral de 1 %, variación inusual de 15 %, redondeo de $ 10, aviso siempre activo, una cotización para todo el
sistema) pasa a ser configuración de la organización.

## Base de datos

- `dominio.cotizacion_configuracion` (esquema `dominio`: es dominio del producto), con RLS por organización y
  sección `cotizacion_dolar`. RPC `obtener_configuracion_cotizacion` / `guardar_configuracion_cotizacion`.
- `empresa_id` nullable en `cotizacion_pendiente`, `cotizaciones` y `cotizacion_aplicada`; con alcance «empresa»
  cada empresa tiene su cotización. `previsualizar_cambio_alcance` solo lee; `cambiar_alcance_cotizacion` cambia
  en una transacción y exige la confirmación. Migraciones aditivas; reversión en el encabezado de cada una.
- `estado_cotizacion`, `cotizacion_del_dia`, `listar_cotizaciones`, `previsualizar/confirmar/descartar_cotizacion`
  reciben `p_empresa`; sin empresa y con alcance «empresa» devuelven la cotización general.

## Pantalla `/cotizacion`

- Tarjeta **Configuración** (`TarjetaConfiguracion`): alcance, redondeo, umbral, aviso en Inicio. Sin edición en
  «Cotización del dólar» es de solo lectura. Guardar el alcance abre `DialogoAlcance` (carga diferida) con la
  vista previa «Qué va a cambiar» por empresa; recién «Cambiar alcance» lo aplica.
- Con alcance «una por empresa» la pantalla sigue a la **empresa activa** de la barra superior (Principio VIII):
  estado, historial, aviso y carga se acotan a ella; en «Todas mis empresas» se elige con `FiltroEmpresa` y no se
  puede cargar hasta elegir una; al cambiar de empresa un diálogo de carga abierto se cierra con aviso.
- `AvisoCotizacion` respeta «Aviso en Inicio» y la empresa activa. En la pestaña «Precios y moneda» de una empresa,
  `Cotización que usa` dice «La general del sistema» o «La de <Empresa>», con su dólar vigente, y `Cotización →`
  lleva a `/cotizacion` (con acceso a la sección).

## Pruebas

pgTAP `cotizacion_configuracion.test.sql` y `cotizacion_alcance.test.sql`; Vitest `TarjetaConfiguracion.test.tsx`,
`DialogoAlcance.test.tsx`, `pages/cotizacion/index.test.tsx`, `pages/empresas/precios.test.tsx`,
`AvisoCotizacion.test.tsx`.
