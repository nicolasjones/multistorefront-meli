import os

from superset.config import WTF_CSRF_EXEMPT_LIST as _WTF_CSRF_EXEMPT_LIST_BASE

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]
SQLALCHEMY_DATABASE_URI = (
    "postgresql+psycopg2://superset:"
    f"{os.environ['SUPERSET_DB_PASSWORD']}@superset-postgres:5432/superset"
)
REDIS_HOST = "superset-redis"
REDIS_PORT = 6379
WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = False  # TLS is terminated by the VPS reverse proxy.

# La cuenta de servicio de emitir-acceso-reporte (research.md #3) llama a
# /security/guest_token/ server-to-server, solo con el Bearer del login —
# sin cookie de sesión que darle a la protección CSRF (verificado con el
# quickstart de la spec 007, sección 2: sin esto, ese endpoint devuelve 400
# "The CSRF token is missing" incluso mandando X-CSRFToken, porque la
# validación exige la sesión asociada, no solo el token). /security/login
# ya viene exento por Flask-AppBuilder — no hace falta agregarlo acá.
#
# WTF_CSRF_EXEMPT_LIST toma "<módulo>.<nombre de función>" de la vista real
# (lo que csrf.exempt() compara en cada request — ver
# flask_wtf.csrf.CSRFProtect.exempt), no una ruta ni una regex.
#
# IMPORTANTE: se EXTIENDE la lista default de Superset
# (`superset.config.WTF_CSRF_EXEMPT_LIST`), nunca se reemplaza — esa lista
# trae de fábrica `superset.charts.data.api.data` (el POST que arma
# `/api/v1/chart/data`, lo que efectivamente pinta un chart). Sobreescribirla
# sin el `+` de abajo saca esa exención sin querer y el SDK embebido se cae
# con "The CSRF token is missing" al pedir los datos del chart — mismo
# problema estructural que guest_token: los usuarios guest nunca tienen
# sesión, así que cualquier endpoint que llamen necesita estar acá (bug
# real de esta spec, encontrado y corregido en quickstart.md sección 2).
WTF_CSRF_EXEMPT_LIST = _WTF_CSRF_EXEMPT_LIST_BASE + [
    "superset.security.api.guest_token",
]

# Analítica embebida por organización (spec 007). El propio SDK
# (@superset-ui/embedded-sdk) requiere este feature flag para servir un
# dashboard dentro de un iframe ajeno a Superset.
#
# EMBEDDABLE_CHARTS en False por default: su default real de Superset es
# True, y agrupa "Embed code" en el mismo menú que "Copy permalink"/"Share
# by email" de cada chart — un producto derivado que lo necesite lo prende
# a propósito, pero por defecto nadie debería poder generar un embed nuevo
# desde la UI de Superset sin decisión explícita (ver docs/operar-superset.md).
FEATURE_FLAGS = {"EMBEDDED_SUPERSET": True, "EMBEDDABLE_CHARTS": False}

# Firma los guest tokens de embedding (research.md #3/#5 de la spec 007) —
# distinto de SECRET_KEY, para no acoplar la rotación de uno con la del
# otro.
GUEST_TOKEN_JWT_SECRET = os.environ["SUPERSET_GUEST_TOKEN_JWT_SECRET"]

# Rol asignado a cualquier guest token. El acceso a LOS DATOS del
# dashboard (qué filas ve, vía `rls`) lo resuelve el propio guest token,
# no este rol — pero el rol SÍ necesita permisos de LECTURA de metadata
# propios, porque el bootstrap del SDK hace varias llamadas de solo
# lectura antes de pintar nada, cada una protegida por el RBAC normal de
# Superset (el bypass de guest token solo cubre el query de datos en sí,
# `chart/data`, no estas). Sin estos permisos el navegador solo muestra
# "Something went wrong with embedded authentication" o "SupersetApiError:
# Forbidden", sin más detalle (encontrado en quickstart.md sección 2,
# T023):
#   - `can_read` sobre `CurrentUserRestApi` (`GET /api/v1/me/roles/`)
#   - `can_read` sobre `Dashboard` (`GET /api/v1/dashboard/<id>`)
# Esto alcanza para que el bootstrap del SDK no falle, pero cada chart
# embebido individual necesita además una segunda capa de permisos para
# que su pedido de datos no dé "Forbidden". Las dos capas las otorga
# configurar_embebido.py en cada `superset-init` (antes se cargaban a mano
# y se perdían con el volumen) — ver docs/operar-superset.md.
GUEST_ROLE_NAME = "Guest"

# Habilita que el navegador de Refine (otro origen) pueda pedir el iframe
# embebido. El dominio real se toma de una variable de entorno, no se
# hardcodea localhost — salvo las dos variantes de loopback de desarrollo
# local (localhost/127.0.0.1), que se agregan siempre además de
# REFINE_ORIGIN: el navegador las trata como orígenes distintos para CORS
# aunque apunten al mismo servidor, y quedarse solo con la que puso
# REFINE_ORIGIN rompía el embedding apenas alguien entraba por la otra
# (encontrado corriendo el quickstart de la spec 007, T023). En producción
# esto no habilita nada real: nadie externo puede pegarle a
# localhost/127.0.0.1 del servidor.
#
# El puerto de esas dos variantes sale de WEB_PORT (spec 015) en vez de
# quedar como literal fijo — si un fork corre Refine en otro puerto y
# olvida setear REFINE_ORIGIN, las variantes de loopback igual apuntan al
# puerto correcto en vez de quedarse en el 3100 del template.
_web_port = os.environ.get("WEB_PORT", "3100")
ENABLE_CORS = True
CORS_OPTIONS = {
    "supports_credentials": True,
    "origins": [
        os.environ.get("REFINE_ORIGIN", f"http://localhost:{_web_port}"),
        f"http://localhost:{_web_port}",
        f"http://127.0.0.1:{_web_port}",
    ],
}
