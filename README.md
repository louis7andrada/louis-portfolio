# Louis Andrada – Portfolio Website

This repository contains the source code for louisandrada.com, a static portfolio website built using Hugo and TailwindCSS, deployed on Netlify.

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

2. Hugo Extended (v0.156.0 or compatible)
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

https://louisandrada.com/images/artworks/example.jpg

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
/static/sitemap.xml

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