# Louis Andrada – Portfolio Website

This repository contains the source code for **louisandrada.com**, a static portfolio website built using **Hugo** and **TailwindCSS**, deployed on Netlify.

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
Netlify

---

# Requirements

Install the following software before running the project locally.

1. **Node.js (v18 or newer)**
   https://nodejs.org

2. **Hugo Extended (v0.156.0 or compatible)**
   https://gohugo.io/installation/

Important: you must install the **extended version** of Hugo because Tailwind requires it.

Verify installations:

```bash
node -v
npm -v
hugo version
```

---

# Project Structure

```
louis-portfolio/
│
├─ assets/                 # Compiled assets
├─ content/                # Website content (paintings, pages, posts)
├─ layouts/                # Hugo templates
├─ static/                 # Static files (images, robots.txt, etc.)
│   └─ images/
│
├─ themes/portfolio-theme/ # Hugo theme
│
├─ netlify.toml            # Netlify build configuration
├─ package.json            # Node scripts and dependencies
└─ config.toml / hugo.toml # Hugo site configuration
```

Files placed inside `static/` are copied directly to the final website.

Example:

```
static/images/og-default.jpg
```

becomes:

```
https://louisandrada.com/images/og-default.jpg
```

---

# Installation

Clone the repository.

```bash
git clone https://github.com/louis7andrada/louis-portfolio.git
cd louis-portfolio
```

Install Node dependencies.

```bash
npm install
```

---

# Running the Website Locally

Start the Hugo development server.

```bash
hugo server
```

The site will run at:

```
http://localhost:1313
```

Hugo will automatically reload the browser when files are changed.

---

# Tailwind CSS Compilation

Tailwind styles are compiled through the npm build script.

Run:

```bash
npm run build
```

This command does two things:

1. Compiles Tailwind CSS

```
themes/portfolio-theme/assets/css/main.css
→ assets/css/output.css
```

2. Builds the Hugo site

```
hugo --gc --minify
```

The final website will be generated in:

```
/public
```

---

# Full Production Build

To generate the complete production site:

```bash
npm run build
```

Output directory:

```
/public
```

This folder contains the final static website ready for deployment.

---

# Netlify Deployment

Netlify automatically builds the project using the configuration inside `netlify.toml`.

Build command:

```
npm run build
```

Publish directory:

```
public
```

Environment configuration:

```
HUGO_VERSION = 0.156.0
HUGO_ENV = production
HUGO_EXTENDED = true
NODE_VERSION = 18
```

---

# Important Development Notes

Static assets must be placed in:

```
/static
```

Example:

```
static/images/
static/robots.txt
static/sitemap.xml
```

These files will be accessible directly on the deployed site.

---

# Updating Content

Artwork and page content is typically added through the `content/` directory.

Example structure:

```
content/
  archive/
  artworks/
  about/
```

Each markdown file becomes a page on the site.

---

# Useful Hugo Commands

Start dev server:

```
hugo server
```

Build production site:

```
hugo --gc --minify
```

Clean and rebuild:

```
rm -rf public
npm run build
```

---

# License

All artwork and media contained in this repository are the property of **Louis Andrada**.
