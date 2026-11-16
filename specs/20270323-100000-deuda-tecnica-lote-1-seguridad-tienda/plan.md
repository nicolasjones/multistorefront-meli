# Implementation Plan: Deuda técnica · Lote 1: seguridad e integridad de la tienda pública (MSF-515)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `supabase` (migraciones, Edge Function, pgTAP) y `refine` solo en `apps/web/src/lib` (sin pantallas).

## Enfoque técnico

Tres historias independientes, una migración y un commit por cada una (se pueden revertir por separado). Esquema de cada objeto (Principio VII, re-verificado en plan y tareas): tablas existentes sin cambio de esquema (`public.tienda_dns_plataforma`, `dominio.tienda_envios`); funciones nuevas en `private` (lógica interna); la política de borrado vive en `storage.objects` (infraestructura de Storage).

### MSF-796 · `20270323100000_tienda_identidad_borrado_sin_referencias.sql`
- `private.ruta_identidad_referenciada(text)` (`security definer`, `stable`, `search_path` vacío; `revoke … from public, anon`, `grant execute … to authenticated`): saca la empresa del segundo segmento de la ruta y busca en identidad publicada, borrador y todas las versiones (`logo_ruta`, `banner_ruta`, `banner_movil_ruta`).
- `drop policy if exists … create policy tienda_identidad_objetos_delete` con la condición `not private.ruta_identidad_referenciada(name)` además de las anteriores.
- Front: comentario de `borrarImagenes` (la garantía está en la base) y `tiendaIdentidad.borrado.test.ts`.
- pgTAP `tienda_identidad_borrado_msf796.test.sql` (22): privilegios y definición, una prueba por fuente y columna, borrado real como administrador (referenciado: 0 filas; sin referencia: 1), otra organización, rol sin edición, y liberación al descartar el borrador.

### MSF-797 · `20270323100100_tienda_dns_ip_publica_publica.sql`
- `private.ip_publica_valida(text)` (`immutable`, regex estricta de octetos + `inet <<= any(rangos)`); CHECK `NOT VALID` + validación con aviso; `create or replace` de `obtener_dominio_tienda` y `preparar_verificacion_tienda` (cuerpo idéntico a `20270205110000` más la guarda).
- Edge Function: `handler.ts` mapea `plataforma_no_configurada` a 503; `tls.ts` nuevo con `comprobarTls(host, ip, operaciones, tiempoMs)`; `index.ts` solo cablea `Deno.connect`/`Deno.startTls`; `openapi/verificar-dominio-tienda.json` suma el 503.
- pgTAP `tienda_dns_ip_publica_msf797.test.sql` (32); `tls.test.ts` (8) y un caso nuevo en `handler.test.ts`; `pnpm test:edge:verificar-dominio-tienda` ahora corre los dos archivos.

### MSF-945 · `20270323100200_tienda_envios_visitante_hmac.sql`
- `private.inicializar_visitante_hmac()` (crea el secreto en Vault con `gen_random_bytes(32)` y, solo entonces, pasa los `sha256` viejos a `legado`; devuelve si lo creó) y la llamada en la propia migración.
- `private.hmac_visitante(text)` (lee Vault, falla si falta) y `private.visitante_hash(uuid)` reescrita sobre ella.
- `drop policy if exists … create policy tienda_envios_select` (organización + `empresas_accesibles()` + `nivel_seccion('empresas') = 'edicion'`).
- pgTAP `tienda_envios_hmac_msf945.test.sql` (40); `tienda_contacto.test.sql` pasa de comparar con `sha256` a `private.hmac_visitante`.

## Validación

pgTAP contra la base dev dentro de `begin … rollback`, aplicando la migración en la misma transacción (sin escribir datos); `tienda_contacto` y `tienda_presupuesto_cliente` completos (sin regresiones); `tienda_dominio_verificacion` completo con la migración 797. Vitest de lo tocado, `node --test` de la Edge Function, `tsc -b`, `oxlint`, `vite build` y los guards del repo.

## Riesgos y despliegue

- Vault visible para el rol que migra (ya exigido por `acceso_hmac`).
- Primer día tras MSF-945: el cupo por visitante se reinicia una vez (D-7).
- Orden: MSF-945 antes de encender `tienda_pedidos` fuera de dev.
- Reversión: encabezado de cada migración; revertir el PR no deshace lo ya aplicado en la base.
