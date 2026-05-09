export function asseguraArray(valor, nomCamp) {
  if (Array.isArray(valor)) return valor;
  throw new Error(`El camp '${nomCamp}' ha de ser un array.`);
}

export function asseguraObjecte(valor, nomCamp) {
  if (valor && typeof valor === 'object') return valor;
  throw new Error(`El camp '${nomCamp}' ha de ser un objecte valid.`);
}
