# Contratos: Avisos y listas configurables (MSF-189)

Todas las RPC de `public` llevan `revoke execute … from public, anon` y `grant execute … to authenticated`. Las de `private` no se exponen a la app. Nada cambia la firma de algo existente (sin `BREAKING`).

## F-NOT-01

```ts
listar_preferencias_aviso(): { tipo: string; nombre: string; activo: boolean }[]
```
Solo tipos cuya sección el usuario puede ver (`private.nivel_seccion` ≥ `lectura`). Sin fila de preferencia, `activo = true`.

```ts
guardar_preferencia_aviso(p_tipo: string, p_activo: boolean): { tipo: string; activo: boolean }
```
Escribe solo la fila propia (`auth.uid()`). Errores: `42501` tipo no visible, `22023` tipo desconocido.

```ts
private.emitir_aviso(p_tipo: text, p_organizacion: uuid, p_datos: jsonb): integer
```
`security definer`. Devuelve la cantidad de destinatarios encolados. Agrupa por destinatario + tipo en la ventana de `private.ventana_agrupacion_aviso()` (15 min).

```ts
private.reclamar_avisos_listos(p_limite: integer): { grupo_id: string; destinatario: string; tipo: string; nombre: string; cantidad: number; detalle: jsonb }[]
private.marcar_aviso_enviado(p_grupo_id: uuid): void
private.registrar_fallo_aviso(p_grupo_id: uuid, p_error: text): { estado: 'pendiente' | 'fallido'; proximo_intento: string | null }
```
Los usa el rol de base de Kestra (privilegio mínimo). `marcar_aviso_enviado` es idempotente.

## F-CFG-01

```ts
crear_estado_consulta(p_nombre: string): { id: string; nombre: string; activo: boolean; orden: number }
renombrar_estado_consulta(p_id: string, p_nombre: string): { id: string; nombre: string }
cambiar_estado_estado_consulta(p_id: string, p_activo: boolean): { id: string; activo: boolean }
```
Solo Administrador (`private.puede_escribir()`). Errores: `42501` sin permiso, `23514` nombre vacío, `23505` nombre repetido. Los motivos de stock **no** agregan RPC: usan `dominio.motivos_movimiento` y su RLS de F-STK-02.
