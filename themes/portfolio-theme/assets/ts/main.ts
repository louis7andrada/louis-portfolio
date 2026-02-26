const btn = document.getElementById("mobileMenuBtn");
const menu = document.getElementById("mobileMenu");

btn?.addEventListener("click", () => {
  menu?.classList.toggle("hidden");
});
