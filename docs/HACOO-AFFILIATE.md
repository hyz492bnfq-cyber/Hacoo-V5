# Hacoo Affiliate dashboard integration

The dashboard adds a separate **Commandes Hacoo** tab. It stores fetched orders in the existing persistent data store, deduplicates by order number, supports search and status filtering, and synchronizes only when the user clicks **Actualiser**; no automatic polling is performed.

## FadeHost environment variables

Set these in the FadeHost environment panel (never paste session cookies into chat):

- `HACOO_AFFILIATE_COOKIE`: the current Cookie request header from a signed-in browser session on affiliate.hacoo.app.
- `HACOO_AFFILIATE_APPNAME`: optional; defaults to `pc-sm-affiliate`.
- `HACOO_AFFILIATE_PLATFORM`: `pc` by default; use `h5` only for an H5 session.
- `HACOO_AFFILIATE_SID`: optional if the cookie already contains `sid`.
- `HACOO_AFFILIATE_WEB_ID`: optional, only if the browser request requires it.

After adding the variables, restart the bot and open **Commandes Hacoo**. Use **Synchroniser** for the first sync. The status line reports authentication or API errors.

## Important

The Hacoo session cookie is a secret and expires. Refresh it privately in FadeHost when Hacoo signs the session out. Never commit it to GitHub or include it in logs.

The API returns monetary integer fields. The current dashboard formats these as USD cents; confirm the scale against the Hacoo web report before relying on totals. Cancelled orders are excluded from the dashboard commission totals. The API's signed commission fields are displayed as reported and do not independently prove settlement.
