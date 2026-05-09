// Normalitza diferents formats d'entrada ({x,y} o [x,y]) a coordenades cartesians.
export function normalitzaCoordenades(coordenades) {
  if (!coordenades) return null;

  if (Array.isArray(coordenades)) {
    const [x, y] = coordenades;
    return { x: Number(x), y: Number(y) };
  }

  if (typeof coordenades === 'object' && coordenades.x != null && coordenades.y != null) {
    return { x: Number(coordenades.x), y: Number(coordenades.y) };
  }

  return null;
}

// Converteix coordenades cartesianes a polars respecte d'un centre.
export function coordenadesPolarsRespecteCentre(coordenades, centre) {
  const punt = normalitzaCoordenades(coordenades);
  const centreNormalitzat = normalitzaCoordenades(centre);

  if (!punt) {
    throw new Error("Les coordenades de l'entrega no son valides.");
  }

  if (!centreNormalitzat) {
    throw new Error("Les coordenades del magatzem no son valides.");
  }

  const dx = punt.x - centreNormalitzat.x;
  const dy = punt.y - centreNormalitzat.y;
  const r = Math.sqrt(dx ** 2 + dy ** 2);
  const thetaRadians = Math.atan2(dy, dx);
  const thetaGraus = (thetaRadians * 180) / Math.PI;

  return { r, thetaRadians, thetaGraus };
}

// Valida i normalitza punts d'entrada per calculs de rutes.
export function normalitzaPuntRuta(punt, nomCamp) {
  if (Array.isArray(punt) && punt.length >= 2) {
    return { x: Number(punt[0]), y: Number(punt[1]) };
  }

  if (punt && typeof punt === 'object' && punt.x != null && punt.y != null) {
    return { x: Number(punt.x), y: Number(punt.y) };
  }

  throw new Error(`El punt '${nomCamp}' no te un format de coordenades valid.`);
}
