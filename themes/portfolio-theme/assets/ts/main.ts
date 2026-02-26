// -----------------------------
// MOBILE MENU TOGGLE
// -----------------------------
const btn = document.getElementById("mobileMenuBtn");
const menu = document.getElementById("mobileMenu");

btn?.addEventListener("click", () => {
  menu?.classList.toggle("hidden");
});

// -----------------------------
// FEATURED ARTWORK ROTATION (HOME PAGE)
// -----------------------------
interface FeaturedArtwork {
  src: string;
  title: string;
  details: string;
}

const featuredArtworks: FeaturedArtwork[] = [
  {
    src: "/images/featured/featured1.jpg",
    title: "Artwork Title 1",
    details: "2024 • Oil on Canvas • 40 x 50 cm"
  },
  {
    src: "/images/featured/featured2.jpg",
    title: "Artwork Title 2",
    details: "2023 • Acrylic on Panel • 30 x 40 cm"
  },
  {
    src: "/images/featured/featured3.jpg",
    title: "Artwork Title 3",
    details: "2022 • Mixed Media • 50 x 60 cm"
  },
  {
    src: "/images/featured/featured4.jpg",
    title: "Artwork Title 4",
    details: "2021 • Oil on Canvas • 45 x 55 cm"
  }
];

let currentFeaturedIndex = 0;

function rotateArtwork() {
  const img = document.getElementById("featuredArtwork") as HTMLImageElement | null;
  const title = document.getElementById("featuredTitle") as HTMLElement | null;
  const details = document.getElementById("featuredDetails") as HTMLElement | null;

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

// Only start rotation if the featured elements exist (Home page)
if (document.getElementById("featuredArtwork")) {
  setInterval(rotateArtwork, 60000);
}

// -----------------------------
// ARTWORKS PAGE LOGIC
// -----------------------------

interface ArtworkItem extends HTMLElement {
  dataset: {
    year?: string;
    project?: string;
    title?: string;
    medium?: string;
    size?: string;
    availability?: string;
    price?: string;
    image?: string;
  };
}

function initArtworksPage() {
  const gallery = document.getElementById("artworkGallery");
  if (!gallery) return; // Not on artworks page

  const items = Array.from(
    gallery.getElementsByClassName("artwork-item")
  ) as ArtworkItem[];

  const filterYear = document.getElementById("filterYear") as HTMLSelectElement | null;
  const filterProject = document.getElementById("filterProject") as HTMLSelectElement | null;

  const modal = document.getElementById("artworkModal") as HTMLElement | null;
  const closeModalBtn = document.getElementById("closeModal") as HTMLElement | null;

  const modalImage = document.getElementById("modalImage") as HTMLImageElement | null;
  const modalTitle = document.getElementById("modalTitle") as HTMLElement | null;
  const modalMedium = document.getElementById("modalMedium") as HTMLElement | null;
  const modalSize = document.getElementById("modalSize") as HTMLElement | null;
  const modalYear = document.getElementById("modalYear") as HTMLElement | null;
  const modalAvailability = document.getElementById("modalAvailability") as HTMLElement | null;
  const modalPrice = document.getElementById("modalPrice") as HTMLElement | null;

  if (!modal || !modalImage || !modalTitle || !modalMedium || !modalSize || !modalYear || !modalAvailability || !modalPrice) {
    return;
  }

  // Deduplicate options in filters (Hugo template may repeat them)
  function dedupeSelectOptions(select: HTMLSelectElement | null) {
    if (!select) return;
    const seen = new Set<string>();
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

  // Filtering logic
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

  // Modal open
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

  // Modal close helpers
  function closeModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  closeModalBtn?.addEventListener("click", closeModal);

  // Click outside content to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // ESC key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

// Initialize artworks page logic when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initArtworksPage();
});
