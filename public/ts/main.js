"use strict";
(() => {
  // <stdin>
  var btn = document.getElementById("mobileMenuBtn");
  var menu = document.getElementById("mobileMenu");
  btn?.addEventListener("click", () => {
    menu?.classList.toggle("hidden");
  });
  var featuredArtworks = [
    {
      src: "/images/featured/featured1.jpg",
      title: "Artwork Title 1",
      details: "2024 \u2022 Oil on Canvas \u2022 40 x 50 cm"
    },
    {
      src: "/images/featured/featured2.jpg",
      title: "Artwork Title 2",
      details: "2023 \u2022 Acrylic on Panel \u2022 30 x 40 cm"
    },
    {
      src: "/images/featured/featured3.jpg",
      title: "Artwork Title 3",
      details: "2022 \u2022 Mixed Media \u2022 50 x 60 cm"
    },
    {
      src: "/images/featured/featured4.jpg",
      title: "Artwork Title 4",
      details: "2021 \u2022 Oil on Canvas \u2022 45 x 55 cm"
    }
  ];
  var currentFeaturedIndex = 0;
  function rotateArtwork() {
    const img = document.getElementById("featuredArtwork");
    const title = document.getElementById("featuredTitle");
    const details = document.getElementById("featuredDetails");
    if (!img || !title || !details || featuredArtworks.length === 0) return;
    currentFeaturedIndex = (currentFeaturedIndex + 1) % featuredArtworks.length;
    img.style.opacity = "0";
    setTimeout(() => {
      const art = featuredArtworks[currentFeaturedIndex];
      img.src = art.src;
      title.textContent = art.title;
      details.textContent = art.details;
      img.style.opacity = "1";
    }, 500);
  }
  if (document.getElementById("featuredArtwork")) {
    setInterval(rotateArtwork, 6e4);
  }
  function initArtworksPage() {
    const gallery = document.getElementById("artworkGallery");
    if (!gallery) return;
    const items = Array.from(
      gallery.getElementsByClassName("artwork-item")
    );
    const filterYear = document.getElementById("filterYear");
    const filterProject = document.getElementById("filterProject");
    const modal = document.getElementById("artworkModal");
    const closeModalBtn = document.getElementById("closeModal");
    const modalImage = document.getElementById("modalImage");
    const modalTitle = document.getElementById("modalTitle");
    const modalMedium = document.getElementById("modalMedium");
    const modalSize = document.getElementById("modalSize");
    const modalYear = document.getElementById("modalYear");
    const modalAvailability = document.getElementById("modalAvailability");
    const modalPrice = document.getElementById("modalPrice");
    if (!modal || !modalImage || !modalTitle || !modalMedium || !modalSize || !modalYear || !modalAvailability || !modalPrice) {
      return;
    }
    function dedupeSelectOptions(select) {
      if (!select) return;
      const seen = /* @__PURE__ */ new Set();
      const options = Array.from(select.options);
      options.forEach((opt) => {
        const val = opt.value;
        if (val === "all") return;
        if (seen.has(val)) {
          select.removeChild(opt);
        } else {
          seen.add(val);
        }
      });
    }
    dedupeSelectOptions(filterYear);
    dedupeSelectOptions(filterProject);
    function applyFilters() {
      const yearValue = filterYear?.value || "all";
      const projectValue = filterProject?.value || "all";
      items.forEach((item) => {
        const itemYear = item.dataset.year || "";
        const itemProject = item.dataset.project || "";
        const matchYear = yearValue === "all" || itemYear === yearValue;
        const matchProject = projectValue === "all" || itemProject === projectValue;
        if (matchYear && matchProject) {
          item.classList.remove("hidden");
        } else {
          item.classList.add("hidden");
        }
      });
    }
    filterYear?.addEventListener("change", applyFilters);
    filterProject?.addEventListener("change", applyFilters);
    items.forEach((item) => {
      item.addEventListener("click", () => {
        const { image, title, medium, size, availability, price, year } = item.dataset;
        if (image) modalImage.src = image;
        modalTitle.textContent = title || "";
        modalMedium.textContent = medium ? `Medium: ${medium}` : "";
        modalSize.textContent = size ? `Size: ${size}` : "";
        modalYear.textContent = year ? `Year: ${year}` : "";
        modalAvailability.textContent = availability ? `Availability: ${availability}` : "";
        modalPrice.textContent = price ? `Price: ${price}` : "Price: On request";
        modal.classList.remove("hidden");
        modal.classList.add("flex");
      });
    });
    function closeModal() {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    closeModalBtn?.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeModal();
      }
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    initArtworksPage();
  });
})();
