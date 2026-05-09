// Conversio global de capacitat: 1 pale = 60 caixes.
export const CAIXES_PER_PALE = 60;

// Definicio hardcodeada de la flota fixa per tipus de camio.
export const FROTA_BASE = Object.freeze([
  {
    tipus: '6-pales',
    quantitat: 11,
    capacitatPales: 6,
  },
  {
    tipus: '8-pales',
    quantitat: 4,
    capacitatPales: 8,
  },
  {
    tipus: '3-pales',
    quantitat: 1,
    capacitatPales: 3,
  },
]);

// Mateixa flota, pero amb capacitat ja calculada en caixes.
export const FROTA_BASE_AMB_CAIXES = Object.freeze(
  FROTA_BASE.map((item) =>
    Object.freeze({
      ...item,
      capacitatCaixes: item.capacitatPales * CAIXES_PER_PALE,
    }),
  ),
);
