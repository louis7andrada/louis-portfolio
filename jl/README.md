# jl.andrada.one: Lulu & Jiji

Who pays whom (Louis, council #10005-#10024, Nov 15 2026). Its own Cloudflare Worker, separate from the website
(Netlify builds only the Hugo folders; this folder is never published by it) and from the council.

- The page, the nine-square 404 door (same cookie as andrada.one's wall, so open on one is open on both) and the
  payments API are all in `worker.js`. Payments live in one Durable Object (SQLite): kept forever, removed only by
  the page's Remove (tap twice). Font: AndradaMono (`files/`, a copy of `static/fonts/AndradaMono.woff2`).
- Not public (#10019): noindex on every reply, robots.txt disallows all, no workers.dev address, no link anywhere.
  No keys (#10005): anyone who knows the address and opens the door can add or remove payments.
- Deploy (laptop, Louis's Cloudflare login): `cd jl` then `npx wrangler@4 deploy`. The first deploy creates the
  jl DNS record and certificate. Free plan only.
- The folder is `files/`, not `public/`: the repo's .gitignore drops every `public/` (Aster, council #10030).
- Local: `npx wrangler@4 dev --local`, then open the printed address.
