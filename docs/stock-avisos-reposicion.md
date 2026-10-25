# Stock · Avisos de reposición (F-STK-09)

Resumen por correo de los productos que **entraron en alerta** de reposición (stock bajo o sin stock). Una
vez por día, sin duplicar y sin pantalla nueva. Spec:
`specs/20261024-130000-stock-carga-exportacion-y-avisos/` (US3, FR-201…FR-208, SC-201, SC-202).

## Qué es «nuevo en alerta»

Un producto **activo** cuyo estado en `public.stock_estados` es `stock_bajo` o `sin_stock` y que:

- nunca se avisó (no tiene marca en `dominio.stock_alertas_avisadas`), o
- se avisó como `stock_bajo` y hoy está `sin_stock` (empeoró).

No se vuelve a avisar si el producto sigue igual o mejora sin salir de la alerta (`sin_stock` → `stock_bajo`).
Si vuelve a `disponible` (o se desactiva), el siguiente barrido le **borra la marca**: si más tarde vuelve a
entrar en alerta, se avisa de nuevo. Si en un día no hay productos nuevos, **no se genera ni se envía nada**.

## Contenido del correo

- Asunto: «N productos sin stock y M con stock bajo» (en singular: «1 producto sin stock y …»).
- Por producto: nombre, SKU, stock, disponible, mínimo y estado. «Sin stock» primero y luego por nombre.
- Tope de **50 productos** por correo; el resto se resume con el total.
- Enlace al panel de Stock (`<PANEL_URL>/stock`).
- Texto plano: nombre y SKU se limpian de saltos de línea.

## Frecuencia y disparo

El flow de Kestra `infra/kestra/flows/avisos-reposicion-stock.yml` corre **una vez por día** (por defecto
`0 9 * * *`, hora del servidor de Kestra; se cambia editando el cron del YAML) y llama a la Edge Function
`enviar-resumen-reposicion` con `{"barrer": true}`. La base solo calcula y registra: no hace HTTP.

## Garantías

- **Marcas solo tras entrega exitosa.** `generar_resumen_reposicion` arma y reserva el resumen (2 minutos);
  `cerrar_resumen_reposicion(…, true)` marca los productos. Un envío fallido no marca nada: el reintento
  reutiliza el mismo registro (suma un intento, hasta 5) y vuelve a incluir los mismos productos más los que
  hayan entrado en el medio.
- **Sin duplicados por barridos simultáneos:** un resumen reservado hace menos de 2 minutos no se vuelve a tomar.
- **Al menos una vez.** Si el correo sale pero la base no puede cerrar el resumen, el próximo barrido lo vuelve
  a enviar (se prefiere un duplicado a perder el aviso).
- **Registro** en `dominio.stock_avisos_reposicion`: estado (`pendiente`, `enviado`, `fallido`,
  `sin_destinatario`), intentos, último error sanitizado (una línea, hasta 500 caracteres), productos incluidos.

## Destinatarios y dependencia de MSF-189

La entrega y los destinatarios los debe definir el mecanismo de avisos del componente Plataforma
(**MSF-189**), que **todavía no está en `main`**. Mientras tanto,
`private.destinatarios_resumen_reposicion(organizacion)` es el **único punto** que resuelve a quién se envía:
los correos de los miembros **activos** de la organización con **edición** en la sección Stock. Cuando MSF-189
entregue su contrato, se reemplaza solo esa función (sin tocar la Edge Function ni el flow). Esta historia no
agrega pantalla de destinatarios ni de configuración.

Si no hay destinatarios, el resumen queda registrado como `sin_destinatario`, **no marca productos** y se
retoma en el siguiente barrido cuando aparezca alguno.

## Seguridad

- Tablas nuevas en el esquema **`dominio`** (datos del producto), con RLS por organización: lectura para quien
  tiene Stock en `lectura` o `edicion`; **sin escritura desde la app**; `anon` sin privilegios.
- Las tres RPC (`generar_resumen_reposicion`, `cerrar_resumen_reposicion`, `organizaciones_con_resumen_pendiente`)
  son **solo de `service_role`**: `authenticated` y `anon` no pueden ejecutarlas.
- La Edge Function exige `x-aviso-token` (secreto compartido, comparación en tiempo constante). El destinatario
  nunca viene del pedido, así que no es un relay abierto. La clave de servicio vive solo en la función.

## Variables

| Dónde | Variable | Para qué |
|-------|----------|----------|
| `supabase/functions/.env.example` | `AVISOS_REPOSICION_TOKEN` | Secreto compartido con el flow (también `PANEL_URL` y `SMTP_*`, ya existentes). |
| `infra/kestra/.env.example` | `AVISOS_REPOSICION_URL`, `AVISOS_REPOSICION_APIKEY` | URL de la función y clave pública (anon) para pasar el gateway. |
| `infra/kestra/.env.example` | `SECRET_AVISOS_REPOSICION_TOKEN` | El mismo token **en base64** (Kestra decodifica los `SECRET_*`). |

Los valores reales viven solo en los secretos de la función y en `infra/kestra/.env`, nunca en Git.

## Pruebas

- pgTAP: `supabase/tests/database/stock_resumen_reposicion.test.sql` (`pnpm test:db`).
- Handler: `pnpm test:edge:enviar-resumen-reposicion`.
- Flow: `pnpm test:kestra:avisos-reposicion` y `pnpm infra:config`.

## Reversión

Migraciones aditivas `20261212140000` y `20261212140100`. Para deshacer (migración posterior): borrar las
funciones y luego las dos tablas (pasos en el encabezado de cada migración), borrar el flow y retirar la
función `enviar-resumen-reposicion`. Los correos ya enviados no se pueden retirar.
