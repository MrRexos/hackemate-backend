/**
 * Geocodificació Nominatim (OpenStreetMap).
 * @param {string} adreca
 * @param {typeof fetch} [fetchImpl]
 */
export async function geocodificarAdrecaNominatim(adreca, fetchImpl = fetch) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', adreca);

  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'HackeMate/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Error geocodificant l'adreca (${response.status}).`);
  }

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`No s'han trobat coordenades per a: ${adreca}`);
  }

  return {
    x: Number(resultats[0].lon),
    y: Number(resultats[0].lat),
  };
}
