# Fix: MSF-748

- Causa: `20270112140500_envio_aislamiento.sql` pasó la lectura de `dominio.comprobantes_venta` a privilegio por columna; `20270201100100_contactos_vinculos.sql` agregó `contacto_id` sin concederlo.
- Cambio: migración aditiva `20270201200141_comprobantes_contacto_id_lectura.sql` con `grant select (contacto_id) ... to authenticated`. `origen_tipo`/`origen_id` siguen sin conceder (el test los excluye a propósito).
- Reversión documentada en la migración (`revoke select (contacto_id)`).
