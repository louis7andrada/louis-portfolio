"use strict";
(() => {
  // <stdin>
  var btn = document.getElementById("mobileMenuBtn");
  var menu = document.getElementById("mobileMenu");
  btn?.addEventListener("click", () => {
    menu?.classList.toggle("hidden");
  });
})();
