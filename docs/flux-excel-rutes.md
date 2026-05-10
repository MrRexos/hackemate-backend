# Flux Excel → rutes (resum)

Aquest document resumeix **què fa** el pipeline principal i **en quin ordre** intervenen els fitxers. El punt d’entrada és `src/scripts/excel-a-entregues-geocodificar.js` (npm: `excel:entregues-geocode`).

---

## Els 7 passos (ordre d’execució)

| Pas | Què passa |
|-----|-----------|
| **1** | Es llegeix el full de **comandes** (`.xlsx`): files → objectes `Pedido` (producte, quantitat, tipus càrrega, adreça, dia…). |
| **2** | Es **filtren** els pedidos per dia (`--dia`, primers N dies, o tots) i s’**agrupen** en **entregues** (una parada = mateix destí / agrupació lògica). |
| **3** | Es llegeix l’Excel d’**horaris** (opcional): per dia de setmana + nom de comerç s’assignen **franges** `horaInici` / `horaFinal` a cada entrega. |
| **4** | **Geocodificació**: cada entrega amb adreça obté `coordenades` (Nominatim) o coords **mock** (`--sense-geocode`). Sense coords vàlides, l’entrega **no** entra al planificador. |
| **5** | Es comprova el conjunt d’entregues **planificables** (coordenades vàlides) i es mostra el veredicte a consola. |
| **6** | **`generarRutes`** (sweep optimizer): magatzem + flota de camions → vector de **rutes** (ordre de parades, camió, volum, hores aproximades) i possible llista d’**entregues no assignades**. |
| **7** | Es demanen **geometries per carrer** (OSRM), es construeix el **JSON** d’export i el **HTML** amb mapa (Leaflet) a `output/`. |

---

## On és cada cosa (fitxers i carpeta)

### Entrada (dades)

- **`fixtures/excel/comandes.xlsx`** — full de comandes per defecte (es pot canviar amb `EXCEL_PATH` o `--excel`).
- **`fixtures/excel/horaris.XLSX`** — franges per defecte (`HORARIS_EXCEL_PATH` o `--horaris`).

### Sortida (generada; no versionar en producció si cal)

- **`output/excel-rutes.json`** — pla de rutes + metadades del run.
- **`output/excel-rutes.html`** — mateix pla visualitzat al mapa.
- **`output/geocodificar-cache-coords.json`** — memòria cau opcional de Nominatim (si està activada).

### Script i utilitats pròximes

- **`src/scripts/excel-a-entregues-geocodificar.js`** — orquestra els 7 passos; les funcions tenen comentaris JSDoc al damunt.
- **`src/scripts/utils/rutes-html-visual.js`** — OSRM tram a tram, mètriques de càrrega i generació de l’HTML incrustat.

### Models i serveis (ordre lògic de dependència)

1. **`excel-a-pedidos.reader.js`** — llegeix el xlsx de comandes → `Pedido[]`; normalitza dates (`normalitzaValorDia`).
2. **`entrega.utils.js`** — `agrupaPedidosEnEntregues`: agrupa pedidos en `Entrega[]` (classe `entrega.model.js`).
3. **`excel-horaris.reader.js`** — llegeix horaris i `aplicaFrangesHorariesALesEntregues`.
4. **`geocodificar-adreca.service.js`** (+ **`geocodificar-cache-local.service.js`**) — Nominatim i caché local.
5. **`pedido.model.js`** — línia de comanda; **`factor-tipus-carrega.constants.js`** — conversió a “caixes” per volum logístic.
6. **`sweep-optimizer.service.js`** — `generarRutes`: cluster, finestres, capacitat, OSRM intra-ruta opcional, export JSON opcional via env.
7. **`serialitza-resultat-rutes.js`** — pot desar resultat des de l’optimizer; l’script Excel també fa la seva pròpia serialització (`serialitzaResultatOptim` dins el script).
8. **`flota-exemple-15.js`** + **`camio.model.js`** — flota de referència passada a `generarRutes`.

Altres peces opcionals: API Express (`src/index.js`) per a endpoints HTTP genèrics.

---

## Variables i CLI rellevants (sense llistar-les totes)

- Camí comandes: `EXCEL_PATH`, `--excel`.
- Día: `--dia`, `GEOCODE_DIA`, o primers dies / `--totes-dies`.
- Límit geocodificació: `--max`, `MAX_GEOCODE_ENTREGUES`.
- Magatzem: `--magatzem`, `MAGATZEM_XY`, o defecte Mollet al codi.
- Proves ràpides: `--sense-geocode` (sense Nominatim).

El detall complet és al capçalament de `excel-a-entregues-geocodificar.js`.

---

## Lectura ràpida del codi

1. Obre **`excel-a-entregues-geocodificar.js`** i segueix **`main()`** de dalt a baix.
2. Per entendre l’optimizer, obre **`sweep-optimizer.service.js`** i la documentació JSDoc de **`generarRutes`**.
