# Signing page

`app.js` is a bundle of `src/sign.js` with the Concordium libraries included, so the page needs no CDN.

Rebuild (from a folder with @concordium/browser-wallet-api-helpers 3.3.0, @concordium/web-sdk 12.0.3 and esbuild installed):

    npx esbuild sign/src/sign.js --bundle --format=esm --platform=browser --minify --target=es2020 --outfile=sign/app.js
