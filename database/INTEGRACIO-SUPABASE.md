# Integració Supabase ↔ algoritme de rutes (Hackmate backend)

Aquest document resumeix el que ha de proporcionar el **company** (noms de taules i columnes) i què has de posar al **`.env.local`**.

## 1. Credencials (obligatori)

Al fitxer **`hackemate-backend/.env.local`** (no es puja a Git):

| Variable | Descripció |
|----------|------------|
| `SUPABASE_URL` | URL del projecte (`https://xxxx.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | Clau publicable o anon del dashboard → **Settings → API** |
| `SUPABASE_SERVICE_ROLE_KEY` | Opcional; recomanada si cal fer **UPDATE** de coordenades i les polítiques RLS ho bloquegen |

## 2. Tria com llegir les dades

### Opció A — `LOGISTICS_SOURCE_MODE=flat`

Hi ha una **vista o taula** on cada **fila és un producte** i es repeteixen les dades de l’entrega (mateix `entrega_id`).

- `LOGISTICS_FLAT_VIEW` = nom de la vista o taula (`SELECT *`).
- Les columnes han de poder mapejar-se amb els defaults (vegeu §4) o amb `LOGISTICS_COL_*`.

Si només tens taules normalitzades, el company pot crear una **VIEW** al SQL Editor (plantilla: `supabase-vista-pla-template.sql`).

### Opció B — `LOGISTICS_SOURCE_MODE=joined`

Dues taules separades:

| Variable | Exemple | Significat |
|----------|---------|------------|
| `LOGISTICS_TABLE_ENTREGUES` | `entregas` | Una fila per entrega / parada |
| `LOGISTICS_TABLE_PEDIDOS` | `pedidos` | Una fila per línia de producte amb FK cap a l’entrega |

El codi fa **dos `SELECT *`**, uneix en memòria i agrupa els `pedidos` dins cada `Entrega`. Les entregues **sense cap línia** es retornen amb `pedidos: []`.

## 3. On es guarden les coordenades (geocodificació)

Després de Nominatim, l’`UPDATE` va a la taula:

- `LOGISTICS_ENTREGUES_TABLE` (per defecte igual que la taula d’entregues del company).

La PK i els camps de coordenades han de coincidir amb `LOGISTICS_COL_ENTREGA_PK`, `LOGISTICS_COL_LATITUD`, `LOGISTICS_COL_LONGITUD` (§4).

## 4. Mapatge de columnes (variables `.env`)

Si els noms del company **no** coincideixen amb els defaults, defineix només les variables que calgui.

### Mode `flat` — prefix `LOGISTICS_COL_`

| Env | Per defecte |
|-----|-------------|
| `LOGISTICS_COL_ENTREGA_ID` | `entrega_id` |
| `LOGISTICS_COL_NOM_ENTREGA` | `nom_entrega` |
| `LOGISTICS_COL_ADRECA` | `adreca` |
| `LOGISTICS_COL_HORA_INICI` | `hora_inici` |
| `LOGISTICS_COL_HORA_FI` | `hora_fi` |
| `LOGISTICS_COL_LATITUD` | `latitud` |
| `LOGISTICS_COL_LONGITUD` | `longitud` |
| `LOGISTICS_COL_PEDIDO_NOM` | `pedido_nom` |
| `LOGISTICS_COL_VOLUM_UNITARI` | `volum_unitari` |
| `LOGISTICS_COL_QUANTITAT` | `quantitat` |
| `LOGISTICS_COL_TIPUS_CARREGA` | `tipus_carrega` |

### Mode `joined` — taules

**Entregues** — prefix `LOGISTICS_ENTREGA_` (sense `COL`):

| Env | Per defecte |
|-----|-------------|
| `LOGISTICS_ENTREGA_PK` | `id` |
| `LOGISTICS_ENTREGA_NOM` | `nom_entrega` |
| `LOGISTICS_ENTREGA_ADRECA` | `adreca` |
| `LOGISTICS_ENTREGA_HORA_INICI` | `hora_inici` |
| `LOGISTICS_ENTREGA_HORA_FI` | `hora_fi` |
| `LOGISTICS_ENTREGA_LATITUD` | `latitud` |
| `LOGISTICS_ENTREGA_LONGITUD` | `longitud` |

**Pedidos** — prefix `LOGISTICS_PEDIDO_`:

| Env | Per defecte |
|-----|-------------|
| `LOGISTICS_PEDIDO_ENTREGA_ID` | `entrega_id` |
| `LOGISTICS_PEDIDO_NOM` | `nom_producte` |
| `LOGISTICS_PEDIDO_VOLUM_UNITARI` | `volum_unitari` |
| `LOGISTICS_PEDIDO_QUANTITAT` | `quantitat` |
| `LOGISTICS_PEDIDO_TIPUS_CARREGA` | `tipus_carrega` |

### Persistència coords (UPDATE)

| Env | Per defecte |
|-----|-------------|
| `LOGISTICS_COL_ENTREGA_PK` | `id` |
| `LOGISTICS_COL_LATITUD` | `latitud` |
| `LOGISTICS_COL_LONGITUD` | `longitud` |

## 5. Com provar que tot encaixa

1. Arrenca l’API: `npm run dev`
2. Obre **`http://localhost:3000/api/logistics/integration-config`** → ha de mostrar `sourceMode`, taules/vista i si hi ha URL + clau.
3. Obre **`http://localhost:3000/api/logistics/entregues-preview`** → JSON amb entregues agrupades.

Si surt error de Postgres/RLS, revisa polítiques a Supabase o usa temporalment `SUPABASE_SERVICE_ROLE_KEY` només en local.

## 6. Què necessitem del company (checklist)

- [ ] Nom exacte de les taules (o de la vista pla).
- [ ] Mode `flat` o `joined`.
- [ ] Noms reals de columnes (PK entrega, FK pedido→entrega, adreça, volum, quantitat, coords opcionals).
- [ ] Si RLS està actiu: polítiques `SELECT` (i `UPDATE` si es volen desar coords) o acord per usar **service role** al servidor.
