# Receipt anchoring page

`app.js` is an esbuild bundle of `src/anchor.js` (with `../receipt/`), so the page needs no CDN.

Rebuild from a folder that has @concordium/browser-wallet-api-helpers 3.3.0, @concordium/web-sdk 12.0.3 and esbuild installed:

    NODE_PATH=<that folder>/node_modules npx esbuild anchor/src/anchor.js --bundle --format=esm --platform=browser --minify --target=es2020 --outfile=anchor/app.js
