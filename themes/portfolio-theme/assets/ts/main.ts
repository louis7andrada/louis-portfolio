// -----------------------------
// MOBILE MENU TOGGLE
// -----------------------------
const btn = document.getElementById("mobileMenuBtn");
const menu = document.getElementById("mobileMenu");

btn?.addEventListener("click", () => {
  menu?.classList.toggle("hidden");
});

// -----------------------------
// NEW FEATURED ARTWORK SLIDESHOW (HOME PAGE)
// -----------------------------
function initFeaturedSlideshow() {
  const artworks = (window as any).featuredArtworks;
  if (!artworks || artworks.length === 0) return;

  const img = document.getElementById("featuredArtwork") as HTMLImageElement | null;
  const title = document.getElementById("featuredTitle") as HTMLElement | null;
  const details = document.getElementById("featuredDetails") as HTMLElement | null;
  const link = document.getElementById("featuredLink") as HTMLAnchorElement | null;

  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");

  if (!img || !title || !details || !link) return;

  let index = parseInt(sessionStorage.getItem("featuredIndex") || "0");
  let autoRotate = sessionStorage.getItem("autoRotate") !== "false";
  let interval: number | null = null;

  function fade(callback: () => void) {
    img.classList.add("hidden");
    setTimeout(() => {
      callback();
      img.classList.remove("hidden");
    }, 300);
  }

  function show(i: number) {
    fade(() => {
      const a = artworks[i];
      img.src = a.image;
      title.textContent = a.title;
      details.textContent = `${a.year} • ${a.medium} • ${a.size}`;
      link.href = a.link;
      sessionStorage.setItem("featuredIndex", i.toString());
    });
  }

  function next() {
    index = (index + 1) % artworks.length;
    show(index);
  }

  function prev() {
    index = (index - 1 + artworks.length) % artworks.length;
    show(index);
  }

  function startAuto() {
    if (!autoRotate) return;
    interval = window.setInterval(next, 10000);
  }

  function stopAuto() {
    autoRotate = false;
    sessionStorage.setItem("autoRotate", "false");
    if (interval !== null) clearInterval(interval);
  }

  nextBtn?.addEventListener("click", () => {
    stopAuto();
    next();
  });

  prevBtn?.addEventListener("click", () => {
    stopAuto();
    prev();
  });

  show(index);
  startAuto();
}

document.addEventListener("DOMContentLoaded", initFeaturedSlideshow);

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
  if (!gallery) return;

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
    if (e.target === modal) closeModal();
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

// -----------------------------
// BUY / COMMISSION PAGE LOGIC (FINAL + PERSISTENCE)
// -----------------------------
function initBuyCommissionPage() {
  const modal = document.getElementById("artworkSelectorModal") as HTMLElement | null;
  const openBtn = document.getElementById("openArtworkSelector") as HTMLElement | null;
  const closeBtn = document.getElementById("closeArtworkSelector") as HTMLElement | null;
  const confirmBtn = document.getElementById("confirmArtworkSelection") as HTMLElement | null;

  const preview = document.getElementById("selectedArtworksPreview") as HTMLElement | null;
  const textarea = document.getElementById("selectedArtworkIDs") as HTMLTextAreaElement | null;

  const buyerName = document.querySelector("input[name='buyerName']") as HTMLInputElement | null;
  const buyerEmail = document.querySelector("input[name='buyerEmail']") as HTMLInputElement | null;

  const commissionName = document.querySelector("input[name='commissionName']") as HTMLInputElement | null;
  const commissionEmail = document.querySelector("input[name='commissionEmail']") as HTMLInputElement | null;
  const commissionSize = document.querySelector("input[name='commissionSize']") as HTMLInputElement | null;
  const commissionLocation = document.querySelector("input[name='commissionLocation']") as HTMLInputElement | null;
  const commissionIdea = document.querySelector("textarea[name='commissionIdea']") as HTMLTextAreaElement | null;

  if (!modal || !openBtn || !closeBtn || !confirmBtn || !preview || !textarea) return;

  // -----------------------------
  // RESTORE SAVED DATA
  // -----------------------------
  const savedSelected = JSON.parse(localStorage.getItem("selectedArtworks") || "[]") as string[];

  let selected = new Set<string>(savedSelected);

  const items = Array.from(document.getElementsByClassName("artworkChoice")) as HTMLElement[];

  // Restore checkmarks + rings
  items.forEach((item) => {
    const id = item.dataset.id!;
    const checkmark = item.querySelector(".checkmark-overlay") as HTMLElement;

    if (selected.has(id)) {
      item.classList.add("ring-4", "ring-black");
      if (checkmark) checkmark.classList.remove("hidden");
    }
  });

  // Restore preview thumbnails
  function rebuildPreview() {
    preview.innerHTML = "";

    Array.from(selected).forEach((id) => {
      const item = document.querySelector(`.artworkChoice[data-id="${id}"]`) as HTMLElement;
      if (!item) return;

      const img = item.dataset.image!;
      const thumb = document.createElement("img");

      thumb.src = img;
      thumb.style.width = "48px";
      thumb.style.height = "48px";
      thumb.style.objectFit = "cover";
      thumb.style.borderRadius = "6px";
      thumb.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
      thumb.style.flexShrink = "0";

      preview.appendChild(thumb);
    });

    textarea.value = Array.from(selected).join(", ");
  }

  rebuildPreview();

  // Restore form fields
  function restoreField(field: HTMLInputElement | HTMLTextAreaElement | null, key: string) {
    if (!field) return;
    const saved = localStorage.getItem(key);
    if (saved) field.value = saved;
    field.addEventListener("input", () => localStorage.setItem(key, field.value));
  }

  restoreField(buyerName, "buyerName");
  restoreField(buyerEmail, "buyerEmail");

  restoreField(commissionName, "commissionName");
  restoreField(commissionEmail, "commissionEmail");
  restoreField(commissionSize, "commissionSize");
  restoreField(commissionLocation, "commissionLocation");
  restoreField(commissionIdea, "commissionIdea");

  // -----------------------------
  // OPEN / CLOSE MODAL
  // -----------------------------
  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  });

  function closeModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // -----------------------------
  // SELECT / DESELECT ARTWORKS
  // -----------------------------
  items.forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.dataset.id!;
      const checkmark = item.querySelector(".checkmark-overlay") as HTMLElement;

      if (selected.has(id)) {
        selected.delete(id);
        item.classList.remove("ring-4", "ring-black");
        if (checkmark) checkmark.classList.add("hidden");
      } else {
        selected.add(id);
        item.classList.add("ring-4", "ring-black");
        if (checkmark) checkmark.classList.remove("hidden");
      }

      // Save to localStorage
      localStorage.setItem("selectedArtworks", JSON.stringify(Array.from(selected)));
    });
  });

  // -----------------------------
  // CONFIRM SELECTION
  // -----------------------------
  confirmBtn.addEventListener("click", () => {
    rebuildPreview();
    closeModal();
  });
}

document.addEventListener("DOMContentLoaded", initBuyCommissionPage);


// -----------------------------
// ARCHIVE PAGE YEAR FILTER
// -----------------------------
function initArchivePage() {
  const filter = document.getElementById("archiveYearFilter") as HTMLSelectElement | null;
  if (!filter) return;

  const items = Array.from(document.getElementsByClassName("archive-item")) as HTMLElement[];

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

// -----------------------------
// DARK MODE TOGGLE
// -----------------------------
const darkToggle = document.getElementById("darkModeToggle");

if (darkToggle) {
  darkToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem(
      "theme",
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
  });

  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
}

// -----------------------------
// HOME PAGE VERTICAL IMAGE FIX
// -----------------------------
document.addEventListener("DOMContentLoaded", () => {
  const imgs = document.querySelectorAll(".homepage-image");

  imgs.forEach((img) => {
    img.onload = () => {
      if (img.naturalHeight > img.naturalWidth) {
        img.classList.add("vertical");
      }
    };
  });
});
