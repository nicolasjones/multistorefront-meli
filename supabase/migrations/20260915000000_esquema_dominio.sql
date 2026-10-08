-- Habilita el esquema de dominio. Solo el namespace: sin tablas todavia,
-- se agregan cuando una spec de producto cree su primera tabla de dominio
-- (por ejemplo, el patron de "tabla central" documentado en workers/README.md).
-- El resto del template (organizaciones, perfiles, membresias, feature
-- flags, backups, etc.) sigue viviendo en el esquema de plataforma
-- (public) sin cambios.
create schema if not exists dominio;
