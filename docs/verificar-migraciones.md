---
owner: plataforma
sources:
  - scripts/verificar-migraciones.mjs
  - scripts/migraciones-reversion.mjs
  - scripts/inventariar-migraciones-sin-reversion.mjs
---

# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check` y compara `supabase/migrations` contra una base (`--base`, por defecto
`origin/dokploy`; en un PR, `origin/$GITHUB_BASE_REF`).
Un `--base` sin valor o vacío (`--base ""`) se rechaza con salida 2 en vez de caer en silencio a la base por omisión; un `GITHUB_BASE_REF` vacío (push sin PR) sí usa la base por omisión.

El alcance son **las migraciones propias de la rama** (las que agregó, renombró o modificó desde el
punto de divergencia con la base, `git merge-base`); las colisiones se comparan contra la **punta** de la
base. Lo que la rama heredó sin tocar no se juzga: si la base renumera migraciones o deja dos migraciones
con la misma versión, un PR que quedó atrás no es culpable (MSF-749). Detalle en
[guard-migraciones.md](guard-migraciones.md).

| Regla | Resultado |
|---|---|
| Versión duplicada en la rama | error |
| Versión que ya existe en la base con otro contenido | error |
| DDL no idempotente en archivos nuevos de la rama | error |
| Versión nueva `<=` máxima de la base («REUSADA») | **error** si la base es una rama de épica, si el PR apunta a `dokploy`/`main` (`GITHUB_BASE_REF`) o con `--estricto`; **aviso** si no (corrida local/push contra `origin/dokploy`) |
| Migración **nueva** de la rama sin comentario «Reversión» con pasos (MSF-900) | **error** en las mismas condiciones que «REUSADA»; **aviso** si no |
| La base renumeró migraciones que la rama heredó | **aviso**: actualizá tu rama (merge de la base) antes de mergear |

El CI corre el guard sobre el **merge** de la base en la rama (`refs/pull/N/merge`): el alcance es la
divergencia con la punta de la base, así que una rama que no toca migraciones no puede ser culpada por
lo que la base hizo después de divergir.


## Por qué el orden contra `dokploy` es un aviso en una épica (MSF-672)

`dokploy` avanza con cada épica que mergea, así que la banda de una épica en curso queda siempre «por debajo» de su
máxima. Fallar ahí obligaba a renombrar migraciones legítimas en bucle (cada renombre se invalidaba con el siguiente
merge). La colisión real (duplicada o modificada) sigue siendo error.

El riesgo original sigue cubierto: el aplicador no ejecuta versiones por debajo de la cola ya aplicada (incidente
2026-10-23), por eso el orden es **error en el PR hacia `dokploy`/`main`**. Renumerar una sola vez, al integrar la épica.

Pruebas: `node --test scripts/verificar-migraciones.test.mjs` (parte de `pnpm test:tooling`).

## Reversión obligatoria en las migraciones nuevas (MSF-900)

Toda migración que la rama **agrega** (archivo nuevo, versión que la base no tiene) debe traer en el propio archivo un
comentario con los pasos para deshacerla, con el criterio de `tieneReversion` (`scripts/migraciones-reversion.mjs`, módulo
puro compartido con `validar-migraciones-aditivas.mjs`): una línea de comentario con «Reversión» y pasos reales; no valen
«Reversión: ninguna», «sin reversión» ni el marcador vacío. Ejemplos:

```sql
-- Reversión: drop function public.mi_funcion();
-- Reversión: restaurar desde el backup de la tabla ventas (borra datos sin vuelta atrás)
```

No hay otro escape: una migración sin reversión posible escribe `-- Reversión: restaurar desde el backup de <motivo>`.
Las históricas que la rama no tocó quedan fuera. Las migraciones existentes son **inmutables** y no se reescriben para
agregarles el comentario.

### Inventario de históricas sin reversión

Para listarlas (y ver cuáles son destructivas):

```bash
node scripts/inventariar-migraciones-sin-reversion.mjs        # (o pnpm db:inventariar:sin-reversion) tabla; --json para máquinas; --dir <carpeta>
```

Medición sobre `origin/dokploy` al 2026-11-25: 28 de 812 migraciones sin reversión documentada, **0 destructivas**
(las destructivas ya las exige `validar-migraciones-aditivas.mjs`). Son inmutables y no se reescriben:

- `20260907011152_enable_pgvector.sql`
- `20260907133827_enable_pgtap.sql`
- `20260908172920_fundacion_multitenant.sql`
- `20260908182256_fundacion_multitenant_clientes_organizacion_default.sql`
- `20260908221453_contexto_organizacion_activa.sql`
- `20260909043625_gestion_miembros.sql`
- `20260909050435_cambiar_rol_miembro.sql`
- `20260909051331_remover_miembro.sql`
- `20260909125504_endurecer_permisos_membresias.sql`
- `20260909140000_analitica_embebida.sql`
- `20260910122000_perfil_usuario_foto_sin_identidad.sql`
- `20260915000000_esquema_dominio.sql`
- `20260915120000_orquestacion_error_handler.sql`
- `20260920154501_capacidad_ia_runtime.sql`
- `20260920162332_endpoints_ui_ia.sql`
- `20260920165428_politicas_ia_gobernada.sql`
- `20260920170520_retencion_ia_gobernada.sql`
- `20260921135958_purga_storage_ia.sql`
- `20260921140139_corregir_pendientes_purga_ia.sql`
- `20260921140520_deshabilitar_purga_sql_directa_ia.sql`
- `20260922120000_contexto_panel_operativo.sql`
- `20260923173207_transiciones_outbox_ejecuciones.sql`
- `20261003183000_esperando_aprobacion_ia.sql`
- `20261003233000_mcp_lectura_centralizada.sql`
- `20261003234000_mcp_listar_credenciales.sql`
- `20261005001000_chat_companion_capacidades_rpc.sql`
- `20270227100000_api_decodificar_cursor_devuelve_fila.sql`
- `20270227120000_api_cursor_sin_saltos_de_linea.sql`
