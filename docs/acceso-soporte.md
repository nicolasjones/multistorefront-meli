# Acceso de soporte auditado (F-OPS-04)

Spec: `specs/20261102-100000-auditoria-avanzada-y-soporte/` (US3, FR-014…FR-018). Migración:
`supabase/migrations/20270205110212_acceso_soporte_auditado.sql`. Todo vive en `public` (plataforma, Principio VII).

## Qué cambia para el equipo de soporte

- Para **Ingresar** a una organización desde **Organizaciones** hay que escribir un **motivo** (obligatorio, hasta 500 caracteres).
- El acceso **vence solo a las 4 horas**. El banner de la parte superior muestra «Acceso de soporte hasta HH:MM» (hora de Buenos Aires) y la acción **Salir**.
- Al vencer, la app limpia el contexto y vuelve a Organizaciones con un aviso. Un acceso vencido no ve ninguna fila de la organización ni puede escribir.
- Sigue siendo una organización a la vez: entrar a otra cierra la anterior.

## Qué ve el cliente

Cada ingreso, salida y vencimiento queda en la **Actividad** de la organización visitada (`soporte.ingreso`, `soporte.salida`, `soporte.vencido`), con la persona de soporte como actor, el motivo y el vencimiento. Lo ve el Administrador (y los roles con lectura de Actividad según la matriz); ninguna otra organización. También queda en `superadmin_entradas` (acciones `entrada` / `salida`, con `motivo` en la entrada), en la misma transacción.

## Contrato (BREAKING)

```ts
public.entrar_a_organizacion(org_id uuid, p_motivo text): void   // reemplaza a entrar_a_organizacion(uuid)
public.salir_de_organizacion(): void                              // firma igual; registra soporte.salida o soporte.vencido
```

Errores: `42501` si no es superadmin (o es `anon`), `22023` si el motivo falta, está en blanco o supera 500, `P0002` si la organización no existe. Ambas RPC: `revoke … from public, anon` / `grant … to authenticated`.

## Cómo se aplica la vigencia

- `superadmin_organizacion_activa.vence_en` (default y backfill: `now() + 4 h`).
- La vista `private.superadmin_contexto_vigente` devuelve el contexto sin los vencidos (`security_invoker`).
- La migración reescribe **todas** las funciones que leían la tabla (`private.organizacion_id`, `puede_escribir`, `nivel_seccion`, `puede_accion*`, `rol_id`, los `puede_*_en_empresa`, etc.) para que lean la vista. **Regla para funciones nuevas:** un helper que resuelva la organización del superadmin lee `private.superadmin_contexto_vigente`, nunca la tabla; el pgTAP `acceso_soporte_vigencia.test.sql` falla si una función fuera de entrar/salir referencia la tabla cruda.
- `entrar_a_organizacion` y `salir_de_organizacion` leen la tabla para distinguir salida de vencimiento.

## Pruebas

`supabase/tests/database/acceso_soporte_vigencia.test.sql`, `acceso_soporte_actividad.test.sql` (`pnpm test:db`) y `apps/web/src/components/AccesoSoporte.test.tsx` (`pnpm test`).

## Reversión

Documentada en el encabezado de la migración: restaurar la versión de un argumento, volver los helpers a la tabla, y `drop` de la vista y de las columnas `vence_en` / `motivo`. Los eventos ya escritos se conservan.
