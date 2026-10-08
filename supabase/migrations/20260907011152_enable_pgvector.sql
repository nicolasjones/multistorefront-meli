-- Habilita pgvector. Solo la extension: sin tablas ni indices todavia,
-- se agregan cuando exista una spec que los necesite (busqueda semantica,
-- embeddings, etc.).
create extension if not exists vector;
