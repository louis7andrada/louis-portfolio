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
      // Courier New is the fallback because its character width (0.600em) matches
      // AndradaMono's (0.5996em): until the font arrives, text already takes the same
      // space, so the swap doesn't reflow anything. The generic monospace (Consolas on
      // Windows) is 9% narrower and made the footer re-wrap and jump 20px on phones.
      sans: ['"AndradaMono"', '"Courier New"', 'Courier', 'monospace'],
      mono: ['"AndradaMono"', '"Courier New"', 'Courier', 'monospace'],
    },
      //letterSpacing: {
      //  tighterCustom: '0.0em',
      //},
    },
  },
  plugins: [],
};