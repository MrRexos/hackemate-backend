// Valida que un camp sigui array per evitar errors de map/filter.
export function asseguraArray(valor, nomCamp) {
  if (Array.isArray(valor)) return valor;
  throw new Error(`El camp '${nomCamp}' ha de ser un array.`);
}

// Valida que un camp sigui objecte per constructors i serveis.
export function asseguraObjecte(valor, nomCamp) {
  if (valor && typeof valor === 'object') return valor;
  throw new Error(`El camp '${nomCamp}' ha de ser un objecte valid.`);
}
