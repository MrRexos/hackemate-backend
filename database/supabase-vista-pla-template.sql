-- Plantilla: crear una vista "pla" per usar LOGISTICS_SOURCE_MODE=flat
-- sense canviar el disseny normalitzat del company.
--
-- Passos:
-- 1. Substitueix noms de taules i columnes pels reals del projecte.
-- 2. Executa al SQL Editor de Supabase.
-- 3. Posa LOGISTICS_FLAT_VIEW=nom_de_la_vista al .env.local

-- EXEMPLE (ajusta tot):
/*
create or replace view logistics_entregues_pedidos_pla as
select
  e.id as entrega_id,
  e.nombre as nom_entrega,
  e.direccion as adreca,
  e.hora_apertura as hora_inici,
  e.hora_cierre as hora_fi,
  e.latitud,
  e.longitud,
  p.nombre_producto as pedido_nom,
  p.volumen_unidad as volum_unitari,
  p.cantidad as quantitat,
  p.tipo_carga as tipus_carrega
from public.entregas e
join public.lineas_pedido p on p.entrega_id = e.id;
*/
