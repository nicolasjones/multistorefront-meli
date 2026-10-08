# Crea (si no existe) la cuenta de servicio dedicada que
# supabase/functions/emitir-acceso-reporte usa para pedir guest tokens
# (spec 007, research.md #3) — antes reusaba la cuenta interactiva
# SUPERSET_ADMIN_*, que el plan de la spec ya decía que debía ser una
# cuenta separada. Se corre con `superset shell` (Flask shell: ejecuta
# este archivo statement por statement en el contexto de la app, igual que
# `superset fab create-admin` en el mismo `command` de compose.yaml) porque
# no hay API REST propia para crear roles/permisos hasta que Superset ya
# esté completamente inicializado, y el propio proceso de init es el que
# lo inicializa.
#
# El rol solo tiene el permiso mínimo real que la cuenta necesita:
# `can_grant_guest_token` sobre `SecurityRestApi` (confirmado contra el
# código fuente de Superset 6.1.0, superset/security/api.py — el endpoint
# `POST /security/guest_token/` está protegido con
# `@permission_name("grant_guest_token")` en esa clase, pero
# Flask-AppBuilder antepone siempre el prefijo "can_" al registrar el
# permiso real de cada método — flask_appbuilder/api/__init__.py:
# `self.base_permissions.add(PERMISSION_PREFIX + _permission_name)`. Usar
# "grant_guest_token" a secas crea un permiso nuevo que nadie chequea en
# ningún lado (probado contra una base real: quedaba en la tabla,
# asignado al rol, y el `POST /guest_token/` igual daba 403 — el chequeo
# real es contra "can_grant_guest_token", ya presente en la base desde que
# Superset registra sus vistas al arrancar). Nada de acceso a
# dashboards/charts/datasets: eso lo resuelve el guest token en sí
# (resources/rls), no el RBAC de quien lo pide.
import os

from superset import security_manager
from superset.extensions import db

username = os.environ["SUPERSET_GUEST_TOKEN_USERNAME"]
password = os.environ["SUPERSET_GUEST_TOKEN_PASSWORD"]

role_name = "Guest Token Service"
role = security_manager.find_role(role_name)
if role is None:
    role = security_manager.add_role(role_name)

# add_permission_view_menu (a diferencia de find_permission_view_menu) crea
# el par permiso/view-menu si todavía no existe — Superset no lo registra
# de fábrica: FAB solo auto-sincroniza los permisos "de modelo" (can_add,
# can_edit, ...) de cada vista, no un @permission_name a medida como este
# (confirmado corriendo esto contra una base real: la fila en
# ab_permission y en ab_view_menu ya existía por separado, pero el par en
# ab_permission_view no).
permiso = security_manager.add_permission_view_menu("can_grant_guest_token", "SecurityRestApi")
if permiso not in role.permissions:
    security_manager.add_permission_role(role, permiso)

usuario = security_manager.find_user(username=username)
if usuario is None:
    security_manager.add_user(
        username=username,
        first_name="Guest Token",
        last_name="Service",
        email=f"{username}@local.test",
        role=role,
        password=password,
    )
else:
    # Ya existe (re-arranque del contenedor): solo se asegura el rol
    # correcto, nunca se pisa el password de una cuenta que ya está en
    # uso — mismo criterio que `create-admin || true` de al lado en
    # compose.yaml, que tampoco actualiza nada de una cuenta existente.
    if role not in usuario.roles:
        usuario.roles = [role]

db.session.commit()
