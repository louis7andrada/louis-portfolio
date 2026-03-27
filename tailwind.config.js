module.exports = {
  darkMode: "class",
  content: [
    "./layouts/**/*.html",
    "./content/**/*.md",
    "./assets/**/*.{css,js,ts}",
    "./themes/portfolio-theme/layouts/**/*.html",
    "./themes/portfolio-theme/assets/**/*.{css,js,ts}",
    "./themes/portfolio-theme/content/**/*.md"
  ],
  safelist: [
    'dark',
    'burger', 'burger.open', 
    'filter-dropdown', 'filter-dropdown.open',
    'featured-fade', 'featured-fade.hidden',
    'single-image-box', 'single-image', 'single-details',
    'prevBtnDesktop', 'nextBtnDesktop',
    'mobileMenu', 'mobileMenu.open',
    'moonIcon', 'sunIcon',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui'],
        mono: ['"Inconsolata"', 'monospace'],
      },
      //letterSpacing: {
      //  tighterCustom: '0.0em',
      //},
    },
  },
  plugins: [],
};