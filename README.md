# Louis Andrada – Portfolio Website

This repository contains the source code for handrada.com (louisandrada.com redirects there), a static portfolio website built using Hugo and TailwindCSS, deployed on Netlify.

The site generates static HTML files at build time and serves them via a CDN for maximum performance.

---

# Tech Stack

Static Site Generator
Hugo (Extended version)

Styling
TailwindCSS

Package Manager
Node.js + npm

Deployment
Netlify (manual deploy via CLI recommended to save deploy credits)

---

# Requirements

Install the following software before running the project locally.

1. Node.js (v18 or newer)
   https://nodejs.org

2. Hugo Extended (v0.157.0 or compatible)
   https://gohugo.io/installation/

Important: you must install the extended version of Hugo because Tailwind requires it.

Verify installations:

node -v
npm -v
hugo version

---

# Project Structure

louis-portfolio/
│
├─ assets/                 # Compiled assets
├─ content/                # Website content (paintings, pages, posts)
├─ layouts/                # Hugo templates
├─ static/                 # Static files (images, robots.txt, etc.)
│   └─ images/
│       ├─ artworks/       # All finished artwork images
│       └─ archive/        # Older artwork, archive, or in-progress placeholders
│
├─ themes/portfolio-theme/ # Hugo theme
├─ netlify.toml            # Netlify build configuration
├─ package.json            # Node scripts and dependencies
└─ config.toml / hugo.toml # Hugo site configuration

Files placed inside static/ are copied directly to the final website.

Example:

static/images/artworks/example.jpg

becomes:

https://handrada.com/images/artworks/example.jpg

---

# Installation

Clone the repository:

git clone https://github.com/louis7andrada/louis-portfolio.git
cd louis-portfolio

Install Node dependencies:

npm install

---

# Running the Website Locally

Start the Hugo development server:

hugo server

The site will run at:

http://localhost:1313

Hugo will automatically reload the browser when files are changed.

---

# Tailwind CSS Compilation

Tailwind styles are compiled through the npm build script.

Run:

npm run build

This command does two things:

1. Compiles Tailwind CSS:

themes/portfolio-theme/assets/css/main.css
→ assets/css/output.css

2. Builds the Hugo site:

hugo --gc --minify

The final website will be generated in:

/public

---

# Full Production Build

To generate the complete production site:

npm run build

Output directory:

/public

This folder contains the final static website ready for deployment.

---

# Netlify Deployment

You can deploy in two ways:

1. **Automatic Git-based deployment**
   - Push your code to GitHub.
   - Netlify automatically triggers a build and deploys the site.
   - Configure build command: npm run build
   - Publish directory: public

2. **Manual deploy using Netlify CLI**
   - Install Netlify CLI if not already installed:
     ```
     npm install -g netlify-cli
     ```
   - Login to your Netlify account:
     ```
     netlify login
     ```
   - Navigate to your project and deploy:
     ```
     hugo --gc --minify
     netlify deploy --prod --dir=public
     OR USE:
     npm run deploy
     ```
   - This method only uploads the final /public folder, avoiding unnecessary rebuilds on Netlify.

---

# Important Development Notes

Static assets must be placed in:

/static/images/artworks      # Finished artworks
/static/images/archive       # Older or in-progress artworks
/static/robots.txt

Files will be directly accessible on the deployed site.

---

# Filtering In-Progress Artworks

- Finished artworks are in /static/images/artworks/
- In-progress or archive images are in /static/images/archive/
- Hugo templates automatically filter out any image pointing to /images/artworks/inprogress.jpeg
- Keep in-progress placeholders in archive or same folder but ensure Hugo filter excludes them

---

# Updating Content

Artwork and page content is typically added through the content/ directory.

Example structure:

content/
  archive/
  artworks/
  about/

Each markdown file becomes a page on the site.

---

# Forms, reCAPTCHA and the mailing list

The forms (newsletter popup, unsubscribe, contact, purchase, commission) are the only way clients reach Louis, so they must never break. Each
one posts straight to the Google Apps Script (`webhook_url` in `hugo.toml`).
`window.checkHuman()` in `baseof.html` asks reCAPTCHA v3 for a score (checked by
`netlify/functions/verifyRecaptcha.js`) and blocks a message ONLY when Google
returns a real bot score below 0.5. If the check itself fails (ad-blocker,
timeout, missing `RECAPTCHA_SECRET_KEY`, domain not registered with the key)
the message goes through. The newsletter and unsubscribe forms never reveal
whether an address is already on / not on the list.

Tests: `npm run test:live` with `npm run hugo` running ("Form works end to end").
See CLAUDE.md before touching forms, the CSP in `netlify.toml`, or reCAPTCHA.

# Private files

This repository is public. Never commit newsletter emails (`.msg`), subscriber
lists, or anything with other people's details. `npm run deploy` commits
everything in the folder, so `.gitignore` blocks `Newsletter emails/`, `*.msg`
and `private/`. Everything inside `static/` is published on the website, so
private things go in `private/` (not published, not committed). The font
source files live in `font-source/`, which is not published either.

# Prices

Prices come from each artwork's `price:` field and are shown as `$1,234.50 USD`.

# Images and thumbnails

Artwork, archive and book images live in the `louis-andrada-images` GitHub
repo. Grids show resized WebP copies that Hugo builds once and caches in
`resources/_gen` (`_partials/img-url.html`); lightboxes and popups open the
originals. Image sizes and blur previews come from `data/imageDims.json`
(`python scripts/image-dims.py` after adding images). The first build takes
about a minute; later builds reuse the cache.

# Deploying

Always deploy with `npm run deploy` from the `main` branch. It
(`scripts/deploy.ps1`):

1. refuses to run on any other branch,
2. commits your changes and pulls anything new from GitHub first,
3. pushes to GitHub, and stops before deploying if that fails,
4. builds and deploys to Netlify, then notifies search engines.

So GitHub and the live site always hold the same code. If GitHub has changes
that clash with yours, it stops and nothing is deployed.
`npm run deploy -- -Force` redeploys even when nothing changed.

# Useful Hugo Commands

Start dev server:

hugo server

Build production site:

hugo --gc --minify

Clean and rebuild:

rm -rf public
npm run build

---

# License

All artwork and media contained in this repository are the property of Louis Andrada.