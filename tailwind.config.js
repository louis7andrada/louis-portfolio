/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./layouts/**/*.{html,js,ts}",
    "./content/**/*.{html,md}",
    "./themes/portfolio-theme/**/*.{html,js,ts}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}