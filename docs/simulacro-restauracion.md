---
owner: operacion
sources:
  - specs/20261018-120000-operacion-copias-y-documentacion
---

# Simulacro de restauración (cierre de MSF-457)

Spec `specs/20261018-120000-operacion-copias-y-documentacion` · FR-011 · SC-002.
Procedimiento de restauración: [copias-y-restauracion.md](copias-y-restauracion.md#procedimiento-guiado-de-restauracion).

## Estado

**Pendiente de ejecución en staging.** El protocolo de abajo quedó completo y ejecutable (MSF-520 cerró
los huecos: correo de prueba, marcador de la caída simulada, verificación de roles/grants y cierre de
staging sano), pero **no se corrió**: esta entrega no tiene autorización para tocar staging y no se
firma nada sin ella. No se inventa ningún resultado: la tabla de abajo queda vacía hasta que el
propietario autorice y firme.

`Desvío:` T018 se cierra sin simulacro por falta de autorización sobre staging. Seguimiento
trazado: Tarea `seguimiento` en el tracker «Ejecutar y firmar el simulacro de restauración en staging»
(**MSF-520**, dueño: propietario del producto). Mientras tanto, la restauración sí se comprueba cada semana de
forma automática en un Postgres efímero con el flow `verificar-restauracion`
(historial en `public.verificaciones_restauracion`), pero eso **no reemplaza** el simulacro
completo ni mide el tiempo de punta a punta.

## Objetivos a verificar

| Objetivo | Valor | Cómo se mide |
|---|---|---|
| Pérdida máxima de datos | ≤ 24 h | La «caída simulada» (paso 3) menos la hora del último dato que quedó en la base restaurada |
| Tiempo de recuperación | ≤ 4 h | Desde «se decide restaurar» hasta «el panel responde con datos» |

## Protocolo

1. Anotar la hora de inicio y quién ejecuta. Usar **solo staging**, nunca producción. Sin autorización
   escrita del propietario el simulacro no se ejecuta (en producción además exige aprobación manual).
   Antes de restaurar, confirmar el destino: `select current_database(), inet_server_addr();` con
   `$DATABASE_URL` tiene que devolver la base y el host de staging; si no coinciden, parar.
2. Elegir la última copia de base y de imágenes del historial (`public.respaldos`,
   `public.respaldos_imagenes`) y anotar sus fechas y ubicaciones.
3. **Marcar la caída simulada** (antes de restaurar; después no queda la base viva para consultarla):

   ```sql
   select clock_timestamp() as caida_simulada,
          (select max(creado_en) from public.registro_actividad) as ultimo_dato_vivo;
   ```

   `caida_simulada` es el instante en que «se cae» el sistema; `ultimo_dato_vivo` es la marca del
   último dato que existía en vivo. La tabla testigo es la que tenga escritura reciente
   (`public.registro_actividad` es la de referencia; si está vacía en staging, se usa otra y se anota
   cuál se usó). Con esos dos valores la pérdida se mide como un número, no de memoria.
4. Restaurar la base (sección A de la guía) y las imágenes (sección B).
5. **Reaplicar y verificar los roles/grants.** `pg_restore --no-privileges` no aplica los ACL del
   dump: las funciones `security definer` del historial quedarían ejecutables por `anon` y las tablas
   sin lectura para `authenticated`. Ejecutar el paso 5 de la sección A
   (`select private.reaplicar_privilegios_copias();`) y comprobar:

   ```sql
   select has_function_privilege('kestra_backups', 'public.iniciar_respaldo(text)', 'EXECUTE') as kestra,
          has_function_privilege('authenticated', 'public.iniciar_respaldo(text)', 'EXECUTE') as autenticado,
          has_function_privilege('anon', 'public.iniciar_respaldo(text)', 'EXECUTE') as anon;
   ```

   Lo esperado es `true / false / false` para cada una de las nueve funciones del historial (las de
   `supabase/tests/database/copias_imagenes_verificaciones.test.sql`) y `authenticated` con lectura
   sobre `public.respaldos`, `public.respaldos_imagenes` y `public.verificaciones_restauracion`
   (la RLS las filtra por superadmin).
6. **Probar el aviso por correo.** Con la app levantada, ejecutar a mano `aviso-fallo-copias` desde la UI
   de Kestra y confirmar que el correo llega a `SOPORTE_CORREO`. Los flows avisan con
   `transmitFailed: false`: si el SMTP no está configurado (valores por defecto de ejemplo) el aviso se
   pierde en silencio y el simulacro no cierra.
7. Comprobar: el panel inicia sesión, una organización conocida lista sus datos y una imagen del
   catálogo se ve.
8. **Dejar staging sano** antes de cerrar: `respaldo-postgres` a mano (copia fresca post-restauración),
   `verificar-restauracion` en verde, Kestra, workers y app levantados, y el panel respondiendo con
   datos. Si algo quedó a medias, se anota en el registro como problema encontrado.
9. Anotar la hora de fin, medir la pérdida (la `caida_simulada` del paso 3 menos la hora del último
   dato de la tabla testigo en la base restaurada) y completar el registro.

## Registro del simulacro

| Campo | Valor |
|---|---|
| Fecha | _pendiente_ |
| Ejecutó | _pendiente_ |
| Copia de base usada (fecha) | _pendiente_ |
| Copia de imágenes usada (fecha) | _pendiente_ |
| Pérdida de datos medida | _pendiente_ (objetivo ≤ 24 h) |
| Tiempo total medido | _pendiente_ (objetivo ≤ 4 h) |
| Problemas encontrados | _pendiente_ |
| Resultado | _pendiente_ |
| Firma del propietario | _pendiente_ |

## Riesgo conocido

Las copias viven en el **mismo servidor** que el sistema: perder el servidor completo se lleva
también las copias. Trasladar el destino a S3/B2/SFTP se hace cambiando variables (ver la guía de
copias) y queda como seguimiento aparte.
