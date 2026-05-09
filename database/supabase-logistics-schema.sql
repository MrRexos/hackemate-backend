-- Esquema d’exemple Supabase per al repositori logístic (ajusta noms/camps al teu projecte).
-- Executa-ho al SQL Editor de Supabase o amb migracions.

create table if not exists logistics_entregues (
  id uuid primary key default gen_random_uuid(),
  nom_entrega text,
  adreca text not null,
  hora_inici text,
  hora_fi text,
  latitud double precision,
  longitud double precision,
  created_at timestamptz default now()
);

create table if not exists logistics_pedidos (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references logistics_entregues (id) on delete cascade,
  nom_producte text,
  volum_unitari numeric not null default 1,
  quantitat numeric not null default 1,
  tipus_carrega text
);

create or replace view logistics_entregues_pedidos_pla as
select
  e.id as entrega_id,
  e.nom_entrega,
  e.adreca,
  e.hora_inici,
  e.hora_fi,
  e.latitud,
  e.longitud,
  p.nom_producte as pedido_nom,
  p.volum_unitari,
  p.quantitat,
  p.tipus_carrega
from logistics_entregues e
join logistics_pedidos p on p.entrega_id = e.id;
