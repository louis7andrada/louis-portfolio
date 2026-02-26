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
    src: "/static/featured/featured1.jpeg",
    title: "Artwork Title 1",
    details: "2024 • Oil on Canvas • 40 x 50 cm"
  },
  {
    src: "/static/featured/featured2.jpeg",
    title: "Artwork Title 2",
    details: "2023 • Acrylic on Panel • 30 x 40 cm"
  },
  {
    src: "/static/featured/featured3.jpeg",
    title: "Artwork Title 3",
    details: "2022 • Mixed Media • 50 x 60 cm"
  },
  {
    src: "/static/featured/featured4.jpeg",
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

// ======================================================
// BUY / COMMISSION PAGE LOGIC
// ======================================================

function initBuyCommissionPage() {
  const artworkSelectorModal = document.getElementById("artworkSelectorModal") as HTMLElement | null;
  const openSelectorBtn = document.getElementById("openArtworkSelector") as HTMLElement | null;
  const closeSelectorBtn = document.getElementById("closeArtworkSelector") as HTMLElement | null;
  const confirmSelectionBtn = document.getElementById("confirmArtworkSelection") as HTMLElement | null;

  const previewContainer = document.getElementById("selectedArtworksPreview") as HTMLElement | null;
  const hiddenIDsField = document.getElementById("selectedArtworkIDs") as HTMLInputElement | null;

  const buyForm = document.getElementById("buyForm") as HTMLFormElement | null;
  const buySuccess = document.getElementById("buySuccess") as HTMLElement | null;

  const commissionForm = document.getElementById("commissionForm") as HTMLFormElement | null;
  const commissionSuccess = document.getElementById("commissionSuccess") as HTMLElement | null;

  if (!openSelectorBtn || !artworkSelectorModal) return; // Not on Buy page

  // Track selected artworks
  let selectedArtworks: {
    id: string;
    title: string;
    image: string;
  }[] = [];

  // -----------------------------
  // OPEN ARTWORK SELECTOR MODAL
  // -----------------------------
  openSelectorBtn.addEventListener("click", () => {
    artworkSelectorModal.classList.remove("hidden");
    artworkSelectorModal.classList.add("flex");
  });

  // -----------------------------
  // CLOSE ARTWORK SELECTOR MODAL
  // -----------------------------
  function closeSelector() {
    artworkSelectorModal.classList.add("hidden");
    artworkSelectorModal.classList.remove("flex");
  }

  closeSelectorBtn?.addEventListener("click", closeSelector);

  artworkSelectorModal.addEventListener("click", (e) => {
    if (e.target === artworkSelectorModal) closeSelector();
  });

  // -----------------------------
  // SELECT ARTWORKS
  // -----------------------------
  const artworkItems = Array.from(
    document.getElementsByClassName("artwork-select-item")
  ) as HTMLElement[];

  artworkItems.forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.dataset.id!;
      const title = item.dataset.title!;
      const image = item.dataset.image!;

      const alreadySelected = selectedArtworks.find((a) => a.id === id);

      if (alreadySelected) {
        // Remove selection
        selectedArtworks = selectedArtworks.filter((a) => a.id !== id);
        item.classList.remove("border-black");
        item.classList.add("border-gray-300");
      } else {
        // Add selection
        selectedArtworks.push({ id, title, image });
        item.classList.remove("border-gray-300");
        item.classList.add("border-black");
      }
    });
  });

  // -----------------------------
  // CONFIRM SELECTION
  // -----------------------------
  confirmSelectionBtn?.addEventListener("click", () => {
    if (!previewContainer || !hiddenIDsField) return;

    // Clear preview
    previewContainer.innerHTML = "";

    // Add thumbnails
    selectedArtworks.forEach((art) => {
      const thumb = document.createElement("div");
      thumb.className = "w-16 h-16 rounded overflow-hidden shadow border border-gray-300";

      thumb.innerHTML = `
        <img src="${art.image}" class="w-full h-full object-cover" />
      `;

      previewContainer.appendChild(thumb);
    });

    // Store IDs in hidden field
    hiddenIDsField.value = selectedArtworks.map((a) => a.id).join(",");

    closeSelector();
  });

  // -----------------------------
  // BUY FORM SUBMISSION
  // -----------------------------
  buyForm?.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!hiddenIDsField?.value) {
      alert("Please select at least one artwork before submitting.");
      return;
    }

    buySuccess?.classList.remove("hidden");
    buyForm.reset();
    previewContainer!.innerHTML = "";
    selectedArtworks = [];
    hiddenIDsField.value = "";
  });

  // -----------------------------
  // COMMISSION FORM SUBMISSION
  // -----------------------------
  commissionForm?.addEventListener("submit", (e) => {
    e.preventDefault();

    commissionSuccess?.classList.remove("hidden");
    commissionForm.reset();
  });
}

// Initialize Buy / Commission logic
document.addEventListener("DOMContentLoaded", () => {
  initBuyCommissionPage();
});

// ======================================================
// ARCHIVE PAGE YEAR FILTER
// ======================================================

function initArchivePage() {
  const filter = document.getElementById("archiveYearFilter") as HTMLSelectElement | null;
  if (!filter) return;

  const items = Array.from(document.getElementsByClassName("archive-item")) as HTMLElement[];

  // Deduplicate options
  const seen = new Set<string>();
  Array.from(filter.options).forEach((opt) => {
    if (opt.value !== "all") {
      if (seen.has(opt.value)) filter.removeChild(opt);
      else seen.add(opt.value);
    }
  });

  filter.addEventListener("change", () => {
    const year = filter.value;

    items.forEach((item) => {
      const itemYear = item.dataset.year;
      if (year === "all" || itemYear === year) {
        item.classList.remove("hidden");
      } else {
        item.classList.add("hidden");
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", initArchivePage);

// DARK MODE TOGGLE
const darkToggle = document.getElementById("darkModeToggle");

if (darkToggle) {
  darkToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem(
      "theme",
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
  });

  // Load saved preference
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
}
