---
owner: producto
sources: [specs, infra]
---
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
| Aviso de consulta nueva con alcance por empresa (`private.empresas_accesibles_de_usuario`, `emitir_aviso` extendido) | `20261210130300_consultas_aviso_emitir.sql` | `private` |
| Flow de envío | `infra/kestra/flows/enviar-avisos.yml` | Kestra |
| Pantalla «Avisos por correo» | `/cuenta/avisos` (menú de la cuenta) | `apps/web` |

## Cómo funciona

1. Un componente (p. ej. Consultas) llama `private.emitir_aviso(tipo, organizacion, datos, empresa?)` desde una función `security definer`. No es ejecutable por `authenticated` ni `anon`.
   Consultas lo hace desde `private.encolar_aviso_consulta()` (disparador de `dominio.consultas`, migración `20261210130300`) con el tipo `consulta_nueva`, datos legibles (Empresa, Origen, Nombre, Contacto, Producto, Mensaje) y la empresa de la consulta; si emitir falla, se registra y la consulta se guarda igual.
2. Los destinatarios son los usuarios activos de la organización, con correo, con acceso a la sección del tipo (`private.nivel_seccion_de_usuario`) y con la preferencia encendida (sin fila = encendido). Si el aviso trae `empresa`, además tiene que acceder a esa empresa (`private.empresas_accesibles_de_usuario`): una persona con la sección pero sin la empresa no recibe los datos del visitante.
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

## Verificación de cierre (MSF-189, MSF-561)

Checklist de seguridad (FR-017, FR-019), cubierto por `supabase/tests/database/avisos_listas_grants_seguridad.test.sql` y `rls_en_toda_tabla.test.sql`:

- RLS activo en `tipos_aviso`, `preferencias_aviso`, `avisos_pendientes` (todas `public`, plataforma) y `estados_consulta` (`dominio`, entidad del producto); esquemas re-verificados contra el Principio VII.
- Toda RPC de `public` nueva: `revoke … from public, anon` y `grant … to authenticated`; las de `private` no se conceden a la app.
- Las funciones `security definer` (`emitir_aviso`, reclamo, resultado) fijan `search_path = ''`.
- Kestra (`kestra_orquestacion`) solo ejecuta reclamo y resultado; no toca tablas ni emite avisos.
- El HTML del correo escapa los valores del detalle (`infra/kestra/flows/enviar-avisos.yml`, `pnpm test:kestra:copias`).
- Recorrido SC-007 (apagado = sin correo, encendido = tres consultas en un correo): `avisos_recorrido_sc007.test.sql`.

## Aviso de consulta nueva (FR-012)

MSF-562 conectó el aviso de consulta nueva a `emitir_aviso` con alcance por empresa: el disparador de `dominio.consultas` ya no encola en `dominio.consultas_avisos`; emite `consulta_nueva` con la empresa de la consulta y solo llega a quienes acceden a ella. La dirección de avisos por empresa (`dominio.consultas_configuracion`) solo afecta a los avisos que quedaron encolados por el camino anterior; el alta nueva no la usa.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
