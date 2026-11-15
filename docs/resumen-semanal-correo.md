# Resumen semanal del negocio por correo

Épica MSF-265 · historia F-REP-08 (MSF-287). Spec: `specs/20261101-100000-analitica-avanzada-y-resumen-por-correo/`.

Los administradores de cada organización reciben una vez por semana, por correo, un resumen del negocio: rentabilidad, ventas de la semana y stock en alerta. Quien no quiere recibirlo lo apaga en «Avisos por correo» (`/cuenta/avisos`).

## Piezas

| Pieza | Dónde | Esquema |
|---|---|---|
| Registro de los envíos por destinatario y semana (`resumen_semanal_envios`) + tipo `resumen_semanal` en `tipos_aviso` | `20270403000003_resumen_semanal_tabla.sql` | `dominio` / `public` |
| Armado del resumen, encolado/reclamo idempotente y cierre del envío | `20270403000004_resumen_semanal_funciones.sql` | `private` |
| Flow de envío semanal | `infra/kestra/flows/resumen-semanal.yml` | Kestra |
| Interruptor para dejar de recibirlo | `/cuenta/avisos` (menú de la cuenta) | `apps/web` |

## Cómo funciona

1. El flow `resumen-semanal` corre **una vez por semana** (lunes 09:00, hora del servidor de Kestra) y llama a `private.reclamar_resumen_semanal(limite, semana)`.
2. Destinatarios: miembros **activos** de cada organización, con correo, con acceso a la sección `rentabilidad` (los administradores y el rol Administración) y con la preferencia `resumen_semanal` **encendida** (sin fila = encendido, como el resto de los tipos de MSF-189).
3. Cada destinatario tiene **una fila por semana** en `dominio.resumen_semanal_envios` (clave única organización + destinatario + semana). El reclamo encola a todos los que tienen datos y después toma la cola en tandas de `RESUMEN_SEMANAL_LIMITE`, con `for update skip locked` (sin doble toma) durante 30 minutos. El tope es **el tamaño de la tanda, no un recorte**: con más destinatarios que el tope, los que no entran en la primera tanda salen en la siguiente de la misma corrida (nadie queda sin correo por el tope).
4. El resumen se arma con los datos de la organización del destinatario:
   - **Rentabilidad** — `analitica.rentabilidad_consolidado` (MSF-120): productos con margen, margen promedio ponderado y conteos de productos con margen bajo o negativo.
   - **Ventas de la semana** — `analitica.ventas_producto_mas_vendido` (MSF-347): unidades y facturado de los últimos 7 días y los tres productos más vendidos. El facturado va con su moneda (`ARS`: los comprobantes se guardan en pesos).
   - **Stock en alerta** — `public.stock_estados`: productos sin stock y con stock bajo, y hasta cinco nombres.
5. Cada sección sale **solo si su fuente existe y tiene datos** de esa organización: si la vista de ventas o la de stock no están, la sección no aparece y el resumen sale igual (sin error). Si el destinatario no tiene acceso a la sección, tampoco la recibe (el correo no muestra más que el panel).
6. Si la organización no tiene ningún dato, no se encola nada: no hay correo que enviar.
7. Un correo por destinatario, con el SMTP de Kestra (`KESTRA_SMTP_*`, el mismo de `enviar-avisos`: sin proveedor nuevo). Los valores del resumen se escapan en el HTML.
8. Éxito: `private.marcar_resumen_semanal_enviado` (idempotente). Falló el SMTP tras los reintentos: `private.registrar_fallo_resumen_semanal` deja la fila `fallido` con un motivo fijo («No se pudo enviar el correo»), nunca el mensaje del SMTP (puede traer hosts o credenciales).

## Decisiones tomadas (la épica deja P3 abierta: contenido, destinatarios, día y hora)

Se implementó con estos valores por defecto, que son los que se confirman con el cliente:

| Decisión | Valor por defecto | Cómo se cambia |
|---|---|---|
| Cadencia y hora | Semanal, lunes 09:00 (hora del servidor de Kestra) | Editando el `cron` del trigger en `infra/kestra/flows/resumen-semanal.yml` |
| Periodo del resumen | Los últimos 7 días (inclusive hoy) | En `private.resumen_semanal_datos` (filtro de `fecha`) |
| Quién lo recibe | Miembros activos con acceso a `rentabilidad` y con la preferencia encendida | La preferencia se apaga en «Avisos por correo»; el acceso, con los roles |
| Contenido | Rentabilidad + ventas de la semana + stock en alerta, cada una si hay datos | `private.resumen_semanal_datos` |
| Zona horaria | La del servidor de Kestra (igual que el resto de los flows programados) | Configuración del servidor / del contenedor de Kestra |

El periodo de 7 días se cuenta con el `current_date` de Postgres (la base), no con el reloj de
Kestra: si las dos bases de datos no están en la misma zona, el corte del periodo puede diferir
un día.

## Seguridad

- `dominio.resumen_semanal_envios` tiene RLS por organización (y por sección `rentabilidad`); `anon` y `authenticated` no escriben: escriben solo las funciones `private`.
- La app tampoco **lee** la cola: no hay pantalla que la consuma, así que `authenticated` no tiene privilegio de tabla (los correos de los destinatarios y el último error no salen de la base). La consulta operativa es «como superusuario».
- Las funciones son `security definer` con `search_path = ''` y no se conceden a `anon` ni a `authenticated`.
- Kestra usa el rol de servicio `kestra_orquestacion`, con `EXECUTE` solo sobre las tres funciones del resumen y sin privilegios de tabla.
- Las tres funciones que Kestra ejecuta pasan por el guardia `private.exigir_llamante_kestra()`: si un `revoke`/`grant` futuro dejara entrar a otro rol, se niegan en vez de devolver los correos y los datos del negocio.
- El resumen se arma por organización y con las secciones a las que el destinatario tiene acceso: no se mezclan organizaciones ni datos ajenos al permiso de quien recibe el correo.
- Los valores del resumen se escapan en el HTML del correo.

## Operación

- Ver los envíos y su estado:
  `select estado, count(*) from dominio.resumen_semanal_envios group by 1;` (como superusuario).
- Un envío `fallido` conserva el motivo en `ultimo_error` (hasta 500 caracteres). El motivo se sanea **en la base**: si parece llevar una credencial (mismo criterio que los avisos de reparación), se sustituye por «No se pudo enviar el correo».
- **Garantía de entrega: a lo sumo un correo por destinatario y semana.** Repetir la corrida no duplica: el reclamo solo toma filas `pendiente` y una fila `enviado` no se vuelve a reclamar. Si Kestra se cae con el envío a medio hacer, la fila queda `enviando` hasta que la **corrida siguiente** la barra (el barrido de reclamos vencidos corre dentro de `private.reclamar_resumen_semanal`): recién entonces queda `fallido` con el motivo «La corrida se interrumpió antes de confirmar el envío» y **no se reenvía** (la semana siguiente llega un resumen nuevo).
- **El tope no deja destinatarios afuera.** `RESUMEN_SEMANAL_LIMITE` (50 por omisión) es el tamaño de la tanda: la corrida encola a todos los destinatarios con datos y reclama la cola en tandas hasta vaciarla. Si una corrida se interrumpe y quedan filas `pendiente` de una semana anterior, la siguiente las marca `fallido` con el motivo «La corrida anterior no alcanzó a enviar este resumen» (no se reenvían: la semana nueva trae un resumen nuevo).
- Valores reales de las variables: solo en `infra/kestra/.env`.
- Para dar el alta a un producto nuevo, alcanza con que su vista de `analitica` exista: la sección aparece sola en el resumen.

## Reversión

Migración posterior que haga `drop` de las funciones `private` del resumen, luego `delete from public.tipos_aviso where clave = 'resumen_semanal'` y `drop table dominio.resumen_semanal_envios`. Desactivar el flow `resumen-semanal` en Kestra.

## Verificación

- `supabase/tests/database/resumen_semanal.test.sql`: reclamo idempotente por destinatario y semana, cierre enviado/fallido (con el motivo saneado), la app sin lectura de la cola y privilegios del rol de Kestra.
- `supabase/tests/database/resumen_semanal_secciones.test.sql`: secciones con y sin datos, sección omitida cuando la fuente no existe, y filtro por acceso del destinatario.
- `infra/kestra/flows/resumen-semanal.test.mjs`: contrato del flow (cadencia, SMTP, HTML escapado, reintentos y motivo fijo).
- `supabase/tests/database/rls_en_toda_tabla.test.sql` sigue verde: la tabla nueva tiene RLS activo.
