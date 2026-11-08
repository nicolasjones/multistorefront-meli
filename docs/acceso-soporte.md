# Acceso de soporte auditado (F-OPS-04)

Spec: `specs/20261102-100000-auditoria-avanzada-y-soporte/` (US3, FR-014…FR-018). Migración:
`supabase/migrations/20270207100003_acceso_soporte_auditado.sql`. Todo vive en `public` (plataforma, Principio VII).

## Qué cambia para el equipo de soporte

- Para **Ingresar** a una organización desde **Organizaciones** hay que escribir un **motivo** (obligatorio, hasta 500 caracteres).
- El acceso **vence solo a las 4 horas**. El banner de la parte superior muestra «Acceso de soporte hasta HH:MM» (hora de Buenos Aires) y la acción **Salir**.
- Al vencer, la app limpia el contexto y vuelve a Organizaciones con un aviso. Un acceso vencido no ve ninguna fila de la organización ni puede escribir.
- Si la persona de soporte cierra el navegador sin salir, el vencimiento igual queda asentado: el flow de Kestra `cierre-accesos-soporte` corre cada 15 minutos y ejecuta `private.cerrar_accesos_soporte_vencidos()`.
- **Reingresar a la misma organización con el acceso vigente renueva el vencimiento a 4 horas desde ese momento, sin límite acumulado.** Es el comportamiento actual (`entrar_a_organizacion` hace `on conflict do update`) y queda sin cambios hasta que Nicolás defina el tope; es una decisión de negocio pendiente (¿máximo de renovaciones o de horas seguidas por organización?). Cada reingreso queda igualmente registrado con su motivo.
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
- `entrar_a_organizacion`, `salir_de_organizacion` y `cerrar_accesos_soporte_vencidos` leen la tabla para distinguir salida de vencimiento. Toman el contexto con bloqueo de fila (`FOR UPDATE` / `DELETE ... RETURNING`), así que una salida y el cierre automático simultáneos no duplican `soporte.vencido`.
- **Convención escrita (guardia de CI)**: ninguna función, vista, vista materializada ni política puede referenciar `public.superadmin_organizacion_activa` fuera de la vista `private.superadmin_contexto_vigente` y esas tres funciones. Lo verifica `supabase/tests/database/acceso_soporte_sin_lecturas_crudas.test.sql` (funciones por texto, vistas y políticas por `pg_depend`). Si falla, la función nueva debe leer la vista. La reescritura por regexp de `20270207100003` fue de una sola vez: no se repite para funciones futuras.

## Cierre automático de accesos vencidos

`private.cerrar_accesos_soporte_vencidos()` (`20270215300002`): por cada fila de `superadmin_organizacion_activa` con `vence_en <= now()` borra el contexto, deja la salida en `superadmin_entradas` y registra `soporte.vencido` en la organización visitada. Es idempotente y solo la ejecutan `workers_orquestacion` / `kestra_orquestacion` (`42501` para los demás). El flow `infra/kestra/flows/cierre-accesos-soporte.yml` la dispara cada 15 minutos y, si falla, la ejecución queda en rojo.

## Bitácora inalterable

`superadmin_entradas` tiene triggers `before update/delete/truncate` en **ENABLE ALWAYS** (`20270215300000`) y ningún rol de la API (incluido `service_role`) tiene escritura. Las únicas excepciones son el borrado en cascada al eliminar la organización o la cuenta de la persona de soporte (la FK es `on delete cascade`). Prueba: `superadmin_entradas_inalterable.test.sql`.

## Pruebas

`supabase/tests/database/acceso_soporte_vigencia.test.sql`, `acceso_soporte_actividad.test.sql`, `cerrar_accesos_soporte.test.sql`, `acceso_soporte_sin_lecturas_crudas.test.sql`, `superadmin_entradas_inalterable.test.sql` (`pnpm test:db`), `infra/kestra/validar-cierre-accesos-soporte.test.mjs` y `apps/web/src/components/AccesoSoporte.test.tsx` (`pnpm test`).

## Reversión

Documentada en el encabezado de la migración: restaurar la versión de un argumento, volver los helpers a la tabla, y `drop` de la vista y de las columnas `vence_en` / `motivo`. Los eventos ya escritos se conservan.

## Revisión de seguridad de la épica MSF-170 (T029)

Revisión de `20270207100001`, `20270207100002`, `20270207100003` y `20270210110000` (authz-security):

- **RLS**: `tipos_evento_actividad` con RLS (`select` para `authenticated`, nada para `anon`, sin escritura desde la app);
  `registro_actividad` conserva su RLS por organización y sección. Nadie escribe por API directa.
- **Inalterabilidad**: triggers `before update/delete` y `before truncate` rechazan con `42501`, y se revocó
  `update, delete, truncate` a `public`, `anon`, `authenticated` (y a `service_role` si existe). La **única** vía de borrado es
  `private.depurar_registro_actividad` (retención de 24 meses), que solo ejecutan `workers_orquestacion` y `kestra_orquestacion`.
- **`anon`**: sin ejecución en ninguna RPC nueva (`obtener_detalle_actividad`, `exportar_actividad`, `entrar_a_organizacion(uuid, text)`,
  `salir_de_organizacion`); las funciones `private.*` no las ejecuta `authenticated`.
- **Acceso de soporte**: motivo obligatorio (≤ 500 caracteres), vencimiento de 4 horas (`vence_en`) y una organización a la vez;
  `private.organizacion_id()` y los helpers que leen el contexto ignoran un acceso vencido. Ingreso, salida y vencimiento quedan
  en `superadmin_entradas` y como `soporte.*` en el historial de la organización visitada, en la misma transacción.
- **Hallazgo corregido en la misma épica**: `entrar_a_organizacion` y `salir_de_organizacion` eran `security definer` con
  `set search_path = public` (heredado de `20261013110000`). Pasan a `set search_path = ''` con todos los nombres calificados
  (`public.organizaciones`, `public.superadmin_organizacion_activa`, `public.superadmin_entradas`). Sin cambio de comportamiento.
- **Exportar la actividad**: exige nivel `edicion` en Actividad **y** la acción `exportar`; lectura acotada a la organización de la
  sesión, tope de 50.000 filas, fórmulas neutralizadas en el CSV. Ver `docs/actividad.md`.
- **Verificación**: `rls_en_toda_tabla`, `aislamiento_organizaciones`, los pgTAP de la épica (`registro_inalterable`,
  `depurar_registro_actividad`, `acceso_soporte_*`, `exportar_actividad`) y el test de grants de `anon` corren en el job
  `database` del CI. En local: `tsc` limpio, `oxlint` sin errores y 193 pruebas Vitest en verde.

