# Avisos por correo configurables

Épica MSF-189 · historia F-NOT-01 (MSF-319). Spec: `specs/20261024-120000-avisos-y-listas-configurables/`.

Cada persona elige qué avisos recibe por correo; los avisos repetidos de un mismo tipo llegan agrupados en un solo correo.

## Piezas

| Pieza | Dónde | Esquema |
|---|---|---|
| Catálogo de tipos (`tipos_aviso`, siembra `consulta_nueva`) | `20261210120000_avisos_catalogo.sql` | `public` |
| Preferencias por usuario (`preferencias_aviso`) + `guardar_preferencia_aviso` | `20261210120100_avisos_preferencias.sql` | `public` |
| `listar_preferencias_aviso()` | `20261210120200_avisos_listar_preferencias.sql` | `public` |
| Cola `avisos_pendientes`, `private.nivel_seccion_de_usuario`, `private.emitir_aviso` | `20261210120300_avisos_cola.sql` | `public` / `private` |
| Agrupación (ventana de 15 min) | `20261210120400_avisos_agrupacion.sql` | `private` |
| Reclamo `private.reclamar_avisos_listos` | `20261210120500_avisos_reclamar.sql` | `private` |
| Resultado `marcar_aviso_enviado` / `registrar_fallo_aviso` + permisos del rol de Kestra | `20261210120600_avisos_resultado.sql` | `private` |
| Flow de envío | `infra/kestra/flows/enviar-avisos.yml` | Kestra |
| Pantalla «Avisos por correo» | `/cuenta/avisos` (menú de la cuenta) | `apps/web` |

## Cómo funciona

1. Un componente (p. ej. Consultas) llama `private.emitir_aviso(tipo, organizacion, datos)` desde una función `security definer`. No es ejecutable por `authenticated` ni `anon`.
2. Los destinatarios son los usuarios activos de la organización, con correo, con acceso a la sección del tipo (`private.nivel_seccion_de_usuario`) y con la preferencia encendida (sin fila = encendido).
3. Se encola en `avisos_pendientes`. El primer aviso abre una ventana de 15 minutos (`private.ventana_agrupacion_aviso()`); los siguientes del mismo destinatario y tipo se suman al mismo grupo.
4. El flow `enviar-avisos` corre cada minuto: `reclamar_avisos_listos` toma los grupos vencidos (`for update skip locked`, reclamo de 10 minutos), vuelve a verificar preferencia, actividad y acceso (si ya no corresponde, descarta) y envía un correo por grupo con SMTP genérico (`KESTRA_SMTP_*`).
5. Éxito: `marcar_aviso_enviado` (idempotente). Falla: `registrar_fallo_aviso` reprograma con espera de 1, 2, 4 y 8 minutos; al quinto intento queda `fallido` con el error (hasta 500 caracteres).

## Seguridad

- `avisos_pendientes` tiene RLS sin políticas y sin privilegios para `anon` ni `authenticated`; solo funciones `security definer`.
- Kestra usa el rol de servicio existente `kestra_orquestacion`, con `EXECUTE` solo sobre las tres funciones de avisos.
- Los valores del detalle se escapan en el HTML del correo.
- Los correos de seguridad (invitación, recuperación de contraseña) salen por Supabase Auth: no son tipos del catálogo y no se pueden apagar.

## Registrar un tipo nuevo

Otro componente agrega su tipo con una migración: `insert into public.tipos_aviso (clave, nombre, seccion) values (...)`; `seccion` es la sección de permisos que lo habilita.

## Operación

- Revisar la cola: `select estado, count(*) from public.avisos_pendientes group by 1;` (como superusuario).
- Un grupo `fallido` conserva el error en `avisos_pendientes.error`.
- Garantía de entrega: al-menos-una-vez. Si el correo sale y `marcar_enviado` falla, el reclamo vence (10 min) y el grupo se reenvía: puede llegar un correo repetido en ese fallo poco frecuente.
- El reclamo toma el mismo candado que la emisión (destinatario + tipo): un aviso emitido durante el reclamo nunca se marca enviado sin salir en el correo.
- La ventana de 15 minutos es una propuesta a confirmar con el cliente; se cambia en `private.ventana_agrupacion_aviso()`.

## Reversión

Migración posterior que haga `drop` de las funciones de `private` de avisos, de `public.listar_preferencias_aviso` y `public.guardar_preferencia_aviso`, y luego de `avisos_pendientes`, `preferencias_aviso` y `tipos_aviso`. Desactivar el flow `enviar-avisos` en Kestra.

## Pendiente

Conectar el aviso de consulta nueva a `emitir_aviso` (FR-012) queda en MSF-562, porque Consultas (MSF-122) todavía no está en la base.
