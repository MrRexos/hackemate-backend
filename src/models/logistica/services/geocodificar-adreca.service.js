/**
 * Geocodifica una adreça amb Nominatim (OSM).
 * Respecta la política d’ús Nominatim (~1 petició/s espaiades si crides en bucle).
 *
 * @param {string} adreca
 * @param {typeof fetch} [fetchImpl=fetch]
 * @returns {Promise<{ x: number, y: number }>} x = lon, y = lat
 */
export async function geocodificarAdrecaNominatim(adreca, fetchImpl = fetch) {
  const q = String(adreca || '').trim();
  if (!q) {
    throw new Error('Geocodificació: adreça buida.');
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', q);

  const response = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': 'HackeMate/1.0 (logistica)' },
  });

  if (!response.ok) {
    throw new Error(`Geocodificació HTTP ${response.status} per a: ${q}`);
  }

  const resultats = await response.json();
  if (!Array.isArray(resultats) || resultats.length === 0) {
    throw new Error(`No s’han trobat coordenades per a: ${q}`);
  }

  const primer = resultats[0];
  return {
    x: Number(primer.lon),
    y: Number(primer.lat),
  };
}
