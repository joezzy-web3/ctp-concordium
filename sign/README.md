# Signing page

`app.js` is a bundle of `src/sign.js` with the Concordium libraries included, so the page needs no CDN.

Rebuild all three pages from source with the pinned dependencies:

    npm ci && npm run build:pages

CI rebuilds them on every push and fails if a committed `app.js` differs from its source.
