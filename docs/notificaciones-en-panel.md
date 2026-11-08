# Centro de notificaciones en el panel (MSF-378 · F-NOT-02)

La campanita de la barra superior (entre el buscador y el menú de cuenta) muestra los avisos de la persona
que inició sesión. **No hay una tabla paralela**: lee las mismas filas de `public.avisos_pendientes`
(cola de avisos por correo de F-NOT-01, `docs/avisos-por-correo.md`), un aviso por fila y destinatario.
Quien apagó un tipo en «Avisos por correo» tampoco lo ve en la campanita, porque ese aviso nunca se encola
para esa persona.

## Piezas

| Pieza | Dónde |
|---|---|
| Columna `leido_en` + índice `(user_id, creado_en desc)` | `supabase/migrations/20270217000001_notificaciones_leido.sql` |
| `listar_notificaciones`, `contar_notificaciones_sin_leer`, `marcar_notificaciones_leidas` | `supabase/migrations/20270217000002_notificaciones_funciones.sql` |
| pgTAP | `supabase/tests/database/notificaciones_panel.test.sql` |
| Campanita, lista y hooks | `apps/web/src/components/navegacion/` (`CampanitaNotificaciones`, `ListaNotificaciones`, `useNotificaciones`) |
| E2E | `apps/web/e2e/notificaciones.e2e.ts` |

## Permisos y aislamiento

- Esquema `public` (plataforma). `avisos_pendientes` conserva RLS activada **sin políticas** y sin privilegios
  para `anon` ni `authenticated`: la app solo lee y marca por funciones `security definer`.
- Persona y organización salen de `auth.uid()` y `private.organizacion_id()`; nunca por parámetro.
- Se excluyen los avisos `descartado` y los de tipos cuya sección la persona ya no puede ver
  (`private.nivel_seccion_de_usuario`).
- `revoke … from public, anon` y `grant execute … to authenticated` en las tres funciones.
- `p_limite` se acota a 50. La paginación usa cursor compuesto `(creado_en, id)` (`p_antes_de` + `p_antes_id`, desempata avisos con el mismo instante).

## Comportamiento

- Punto rojo solo si hay avisos sin leer; el botón anuncia «Notificaciones, N sin leer».
- Abrir un aviso lo marca leído; «Marcar todas como leídas» se deshabilita sin pendientes.
- El conteo se refresca al abrir el panel, al volver a la pestaña y cada 60 s solo con la pestaña visible.
- La lista carga por tandas (`IntersectionObserver` + «Cargar más» por teclado) con los estados compartidos.

## Empresa activa: no aplica

Los avisos son personales: ya se filtraron por las empresas a las que la persona accede al emitirse
(`private.empresas_accesibles_de_usuario`, F-NOT-01) y no se reencuadran por la empresa de la barra
superior. La campanita no guarda su propia empresa ni duplica el selector (Principio VIII).

## Reversión

Migraciones aditivas. Para volver atrás, en una migración posterior: `drop function` de las tres funciones
y luego `drop index public.avisos_pendientes_usuario_creado_idx` y
`alter table public.avisos_pendientes drop column leido_en`. En el front, quitar `CampanitaNotificaciones`
de `EncabezadoPanel`.
