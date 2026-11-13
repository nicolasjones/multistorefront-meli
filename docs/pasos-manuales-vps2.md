# Pasos manuales de infraestructura en VPS2 (MSF-854)

Cuatro operaciones que **no se pueden hacer desde el repo**: piden acceso al VPS2
(`212.90.120.53`) y credenciales que no están en Git. Quedan para **Nicolás**. Esta
página es el runbook: cada paso dice qué hay que hacer, el comando, el respaldo
previo, cómo se verifica que quedó bien y cómo se deshace.

**Por qué están pendientes.** El desarrollo no tiene acceso SSH al VPS2 (las
escrituras remotas están bloqueadas) ni las credenciales de los ambientes: por eso
lo que el repo entrega es el procedimiento escrito y su verificación, no la
ejecución. Ningún paso de esta página se puede correr desde el CI.

## Antes de empezar

- Acceso SSH al VPS2 como `root@212.90.120.53`. El deploy automático de
  infraestructura usa una clave propia en el CI (ver [deployment.md](deployment.md));
  estos pasos son los manuales.
- Para el paso 1: un worktree de `main` (el sitio se arma desde `main`; el tooling
  `pnpm docs:wiki:site` y `scripts/docs-api-publica.sh` **solo existen en `main`**,
  no en `dokploy`).
- Para el paso 4: la sesión de un **administrador de la organización** (la RPC exige
  el contexto de la organización del usuario, no un SQL suelto).
- Nada de esto lleva secretos en el repo: las credenciales del sitio de docs, del
  VPS y de los ambientes viven fuera de Git.

## Paso 1 · Publicar el sitio de docs

**Qué:** el sitio de documentación (`https://docs.212-90-120-53.sslip.io`) se
publica aparte del repo, copiando el resultado del build al VPS. Al 2026-11-09 el
publicado era del 2026-11-01 y le faltaban las páginas `producto/contactos/`,
`producto/importaciones/`, `producto/inicio-y-alertas/` y `producto/ventas-mostrador/`
(404) — de ahí el paso pendiente. Esas cuatro ya están en `main` (el build desde
`main` las trae e incluye #886), así que basta reconstruir y republicar.

> Esta página se arma desde `main`, que es una rama distinta de `dokploy`: por eso no
> enlaza páginas que solo existen en `dokploy`. Un enlace a un archivo que no esté
> en `main` hace fallar `mkdocs build --strict` y el sitio no se publica.

**Respaldo previo:** copiar el sitio publicado a un directorio de respaldo con
fecha, en el mismo VPS.

```bash
ssh root@212.90.120.53 'cp -a /srv/docs-site /srv/docs-site.respaldo-AAAAMMDD'
```

**Publicación:**

```bash
rsync -a --delete --exclude=/api-publica/ <worktree de main>/site/ root@212.90.120.53:/srv/docs-site/
```

El `--exclude=/api-publica/` **no es opcional**: el subsitio público de la API vive
dentro de `/srv/docs-site/` y un `--delete` sin excluirlo lo borra (está
documentado en `docs/tecnico/subsitio-api-publica.md`, en `main`).

**Si el build está viejo, se rearma desde `main`:**

```bash
cd <worktree de main>
pnpm docs:wiki:site     # docker run … squidfunk/mkdocs-material:9 … 'mkdocs build --strict'
```

(`pnpm docs:wiki:site` es el atajo de
`docker run --rm --entrypoint sh -v "$PWD:/docs" -w /docs squidfunk/mkdocs-material:9 -c "pip install -r requirements-docs.txt && mkdocs build --strict"`.)

**Verificación:** (no necesita credenciales del sitio)

```bash
ssh root@212.90.120.53 'ls -d /srv/docs-site.respaldo-*; ls /srv/docs-site/producto/contactos/index.html'
```

Con las credenciales del sitio (fuera del repo):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -u "$USUARIO:$CLAVE" https://docs.212-90-120-53.sslip.io/producto/contactos/
```

`200` = la página está publicada. Sin credenciales el sitio responde `401`
(Traefik `basicAuth`): un `401` no dice nada sobre el contenido.

**Reversión:** volver a copiar el respaldo (que queda en el VPS).

```bash
ssh root@212.90.120.53 'rm -rf /srv/docs-site && cp -a /srv/docs-site.respaldo-AAAAMMDD /srv/docs-site'
```

**Después de publicar:** el sitio se arma desde `main`, así que esta página (y
cualquier otra nueva) aparece en el publicado recién cuando llegue a `main` y se
agregue al `nav` de `mkdocs.yml`.

## Paso 2 · Orden de arranque de `tailnet-forwards`

**Qué:** después del reinicio del 2026-11-12 las bases de dev, stg y prd no
arrancaron porque `socat` (el servicio `tailnet-forwards`) tomó sus puertos antes
de que Docker levantara los contenedores. El arreglo es un *drop-in* de systemd que
hace que el servicio arranque **después** de Docker y espere a que la base de
producción esté en pie.

El drop-in sube también `TimeoutStartSec`: systemd corta el arranque a los 90 s por
defecto (`DefaultTimeoutStartSec`) y mataría la espera antes de que levante la base.
Con 600 s hay margen; si aun así no alcanza, el servicio queda **fallido y sin tomar
los puertos**, que es el estado seguro (las bases pueden levantar).

**Comando** (en el VPS):

```bash
install -d /etc/systemd/system/tailnet-forwards.service.d
cat >/etc/systemd/system/tailnet-forwards.service.d/esperar-docker.conf <<'EOF'
[Unit]
After=docker.service
TimeoutStartSec=600

[Service]
ExecStartPre=/bin/sh -c 'until docker ps --format "{{.Names}}" | grep -qx "supabase_db_multistorefront-meli-supabase-prd"; do sleep 2; done'
EOF
systemctl daemon-reload
```

**Verificación:**

```bash
systemctl show tailnet-forwards.service -p After          # debe listar docker.service
systemctl show tailnet-forwards.service -p TimeoutStartUSec   # 10min (600 s)
systemctl cat tailnet-forwards.service | grep -A3 esperar-docker.conf
docker ps --format '{{.Names}}' | grep supabase_db        # las bases de dev/stg/prd arriba
```

**Reversión:** borrar el drop-in y recargar.

```bash
rm /etc/systemd/system/tailnet-forwards.service.d/esperar-docker.conf
systemctl daemon-reload
```

## Paso 3 · Recrear el stack Edge de dev

**Qué:** las funciones `api-v1`, `entregar-webhook` y `cotizacion-sugerida` no
estaban registradas en el runtime de dev: una función Edge nueva no queda
registrada hasta recrear el stack (ver [deployment.md](deployment.md)). El síntoma es
que Kong responde **`Function not found`** (texto plano); un `401`
(`UNAUTHORIZED_NO_AUTH_HEADER`) significa que la función **sí** está registrada y
pide credencial, y el `404` en JSON (`{"error":{"codigo":"no_encontrado",…}}`) es la
propia función respondiendo por una ruta que no existe.

Estado medido desde la red el 2026-11-13:

| Ambiente | `api-v1/v1/openapi.json` | `entregar-webhook` | `cotizacion-sugerida` |
|---|---|---|---|
| dev | `200` (registrada) | `401` (registrada) | `401` (registrada) |
| stg | `Function not found` | `Function not found` | `Function not found` |
| prd | `Function not found` | `Function not found` | `Function not found` |

O sea: **en dev el síntoma ya no se reproduce** (el stack se recreó desde entonces);
el mismo síntoma sigue en **stg y prd**, que no venían en el paso. Si el objetivo es
dejar las funciones sirviendo en todos los ambientes, el recreo del stack tiene que
hacerse también en stg y prd.

**Respaldo previo (obligatorio):** no se reemplaza un contenedor sin guardar su
entorno.

```bash
docker ps --format '{{.Names}}' | grep -i edge
docker inspect <contenedor del runtime Edge> \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  > /root/entorno-edge-runtime-dev-AAAAMMDD-HHMM.env
```

**Recreación:** el stack Edge se rehace en el *workdir* del ambiente (el patrón que
usan `/root/supabase-stg` y `/root/supabase-prd`, ver [deployment.md](deployment.md);
confirmá cuál es el de dev con `ls -d /root/supabase-*`):

```bash
cd <workdir del ambiente>
supabase stop
supabase start
```

Dos avisos:

- **No alcanza con reiniciar el runtime**: reiniciar el contenedor del runtime no
  registra funciones nuevas; hay que rehacer el stack.
- El *workdir* tiene que conservar su `supabase/.env`: de ahí salen los secretos que
  usa el runtime; sin ellos las funciones que los necesitan arrancan sin secreto y
  fallan (500 o 503, según la función).

**Verificación:** (por ambiente; en dev, hoy, ya da lo esperado)

```bash
# api-v1: el contrato se sirve sin clave → si dice "Function not found", no está registrada
curl -sS "https://supabase-dev.212-90-120-53.sslip.io/functions/v1/api-v1/v1/openapi.json" | head -c 60
# las otras dos: 401 = registradas
for fn in entregar-webhook cotizacion-sugerida; do
  curl -sS -o /dev/null -w "$fn %{http_code}\n" "https://supabase-dev.212-90-120-53.sslip.io/functions/v1/$fn"
done
```

**Reversión:** volver a levantar el stack con el entorno respaldado en el paso
anterior (el archivo `.env` del respaldo es el que hay que volver a cargar).

## Paso 4 · Revocar la clave de API de prueba

**Qué:** la clave de prueba `PRUEBA-claude-2026-11-11` (id
`74a567f2-d3d8-416c-bd20-084af9b6b417`) es de una organización de prueba y hay que
revocarla: `public.revocar_clave_api` deja `revocada_en` con hora y la siguiente
llamada con esa clave responde `401`.

**Dónde:** en el panel, **Administración → API → Claves** → botón «Revocar» de esa
clave (la pantalla llama a `public.revocar_clave_api`, ver
`apps/web/src/pages/api/PanelClaves.tsx`). Equivalente por RPC, con la sesión del
administrador de la organización:

```sql
select public.revocar_clave_api('74a567f2-d3d8-416c-bd20-084af9b6b417');
```

Ojo: la función es `security definer` pero resuelve la organización con
`private.organizacion_id()` y exige `private.puede_escribir()` (migración
`20270224110201_api_claves.sql`), o sea que usa el usuario de la sesión
(`auth.uid()`). Un `psql` suelto como `postgres` responde `42501` («Solo un
administrador puede revocar claves de API»): no es un error de la clave, es que
falta el contexto de la organización.

**Verificación:**

```sql
select id, nombre, prefijo, revocada_en
  from public.api_claves
 where id = '74a567f2-d3d8-416c-bd20-084af9b6b417';
```

`revocada_en` con hora = revocada (la función es idempotente: `coalesce(revocada_en,
now())`). La fila se puede leer con `service_role` o como administrador de la
organización.

**Repetir en cada ambiente** donde exista la clave (dev, stg y prd): el id es el de
la clave de la organización de prueba, pero hay que comprobar en cada base.

**Reversión:** la revocación no se deshace (`revocada_en` queda con hora y la función
no lo vuelve a null). Si hace falta una credencial para esa integración, se crea una
clave nueva (Administración → API → Claves → «Crear clave») y se la entrega al
integrador: la anterior queda revocada para siempre.

## Qué no se puede verificar desde el repo

- Que el sitio publicado tenga el contenido nuevo: el sitio está detrás de
  `basicAuth` y sus credenciales no están en Git.
- El estado del VPS2 (servicio, contenedores, base): sin acceso SSH, el repo solo
  puede dejar el procedimiento y la forma de verificarlo.
- Que la clave esté revocada en cada ambiente: la comprobación es por base.

Los cuatro pasos se cierran cuando cada verificación dé lo esperado; hasta entonces
siguen **pendientes** (no se marcan como hechos por el solo hecho de existir esta
página).
