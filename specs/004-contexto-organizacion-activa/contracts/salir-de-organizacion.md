# Contract: RPC `salir_de_organizacion`

**Quién la llama**: Refine, desde la acción "Salir" del banner de
organización activa (Historia 2), solo visible/accesible a superadmin con
una organización activa.

## Request

Llamada RPC de PostgREST (vía `@refinedev/supabase` / `supabase-js`), sin
parámetros:

```ts
supabase.rpc('salir_de_organizacion')
```

## Permisos

`grant execute on function public.salir_de_organizacion() to authenticated;`
— mismo patrón que `entrar_a_organizacion` (spec 003). Sin este grant, la
llamada RPC del request de abajo falla con `permission denied` antes de
llegar a evaluar `private.is_superadmin()`.

## Comportamiento (dentro de la función, `security definer`)

1. Verifica `private.is_superadmin()`. Si es falso, `raise exception` (→
   403 desde PostgREST).
2. Busca la fila de `superadmin_organizacion_activa` para `auth.uid()`.
   - Si **no existe**: no-op — retorna sin error, sin insertar nada en
     `superadmin_entradas` (Clarifications, Q1).
   - Si **existe**: la borra, e inserta en `superadmin_entradas` una fila
     con `accion = 'salida'`, `organizacion_id` la que tenía activa,
     `entrado_en = now()`.

Ambos pasos (borrar la fila activa, insertar la auditoría) ocurren en la
misma transacción de la función.

## Response

Sin cuerpo (`void`) en éxito, tanto si había organización activa como si
no (mismo resultado observable desde el cliente). El frontend, tras la
llamada exitosa, deja de mostrar el banner y oculta las pantallas
dependientes de organización (comportamiento de Historia 1). Error
(excepción) solo si quien llama no es superadmin.
