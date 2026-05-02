const btn = document.getElementById("mobileMenuBtn");
const menu = document.getElementById("mobileMenu");

btn?.addEventListener("click", () => {

  btn.classList.toggle("open");   // burger animation
  menu.classList.toggle("open");  // menu visibility

  // -----------------------------
  // SCROLL LOCK FOR MOBILE MENU
  // -----------------------------
  if (menu.classList.contains("open")) {
    document.body.style.overflow = "hidden";  // disable page scroll
  } else {
    document.body.style.overflow = "";        // restore scroll
  }
});


// -----------------------------
// FEATURED ARTWORK SLIDESHOW (HOME PAGE)
// -----------------------------
function initFeaturedSlideshow() {
  const artworks = (window as any).featuredArtworks;
  if (!artworks || artworks.length === 0) return;

  const img = document.getElementById("featuredArtwork") as HTMLImageElement | null;
  const title = document.getElementById("featuredTitle") as HTMLElement | null;
  const details = document.getElementById("featuredDetails") as HTMLElement | null;
  const link = document.getElementById("featuredLink") as HTMLAnchorElement | null;

  // ONLY ARROWS WE KEEP
  const nextBtnDesktop = document.getElementById("nextBtnDesktop");
  const prevBtnDesktop = document.getElementById("prevBtnDesktop");

  if (!img || !title || !details || !link) return;

  let index = parseInt(sessionStorage.getItem("featuredIndex") || "0");
  let userStopped = false;
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
    if (userStopped) return;
    if (interval !== null) clearInterval(interval);
    interval = window.setInterval(next, 15000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (interval !== null) clearInterval(interval);
    } else {
      if (!userStopped) startAuto();
    }
  });
  window.addEventListener("pageshow", () => {
    userStopped = false;
    startAuto();
  });

  function stopAuto() {
    userStopped = true;
    if (interval !== null) clearInterval(interval);
  }

  // ONLY PREV/NEXT ARROWS
  nextBtnDesktop?.addEventListener("click", () => {
    stopAuto();
    next();
  });

  prevBtnDesktop?.addEventListener("click", () => {
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
    collection?: string;
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
  const filterAvailability = document.getElementById("filterAvailability") as HTMLSelectElement | null;
  const filterCollection = document.getElementById("filterCollection") as HTMLSelectElement | null;


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
  dedupeSelectOptions(filterAvailability);
  dedupeSelectOptions(filterCollection);

  function applyFilters() {
  const yearValue = filterYear?.value || "all";
  const collectionValue = filterCollection?.value || "all";
  const availabilityValue = filterAvailability?.value || "all";

  items.forEach((item) => {
    const itemYear = item.dataset.year || "";
    const itemCollection = item.dataset.collection || "";
    const itemAvailability = item.dataset.availability || "";

    const matchYear = yearValue === "all" || itemYear === yearValue;
    const matchCollection =
      collectionValue === "all" ||
      itemCollection
        .split(",")
        .map(c => c.trim())
        .includes(collectionValue);
    const matchAvailability = availabilityValue === "all" || itemAvailability === availabilityValue;

    if (matchYear && matchCollection && matchAvailability) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
}

  filterYear?.addEventListener("change", applyFilters);
  filterAvailability?.addEventListener("change", applyFilters);
  filterCollection?.addEventListener("change", () => {
  const value = filterCollection.value;

  // Only this specific collection should open a new page
  if (value === "The Tree, The Snake, The Fruit") {
    window.location.href = "/artworks/collection-the_tree_the_snake_the_fruit";
    return;
  }

  // All other collections behave normally (filter only)
  applyFilters();
});

}

document.addEventListener("DOMContentLoaded", () => {
  initArtworksPage();
});

// -----------------------------
// ARCHIVE PAGE FILTERS (YEAR + CATEGORY)
// -----------------------------
function initArchivePage() {
  const yearFilter = document.getElementById("filterYear");
  const categoryFilter = document.getElementById("filterCategory");

  if (!yearFilter || !categoryFilter) return;

  const items = Array.from(document.getElementsByClassName("archive-item"));

  const seen = new Set();
  Array.from(yearFilter.options).forEach((opt) => {
    if (opt.value !== "all") {
      if (seen.has(opt.value)) yearFilter.removeChild(opt);
      else seen.add(opt.value);
    }
  });

  function applyFilters() {
    const selectedYear = yearFilter.value;
    const selectedCategory = categoryFilter.value;

    items.forEach((item) => {
      const itemYear = item.dataset.year;
      const itemCategory = item.dataset.category;

      const matchYear = selectedYear === "all" || itemYear === selectedYear;
      const matchCategory = selectedCategory === "all" || itemCategory === selectedCategory;

      if (matchYear && matchCategory) {
        item.classList.remove("hidden");
      } else {
        item.classList.add("hidden");
      }
    });
  }

  yearFilter.addEventListener("change", applyFilters);
  categoryFilter.addEventListener("change", applyFilters);
}

document.addEventListener("DOMContentLoaded", initArchivePage);


// -----------------------------
// DARK MODE TOGGLE (FINAL)
// -----------------------------
const toggle = document.getElementById("darkModeToggle");
const sunIcon = document.getElementById("sunIcon");
const moonIcon = document.getElementById("moonIcon");

// Ensure initial state: only one icon visible, no spin classes
sunIcon?.classList.add("hidden");
sunIcon?.classList.remove("moonIconSpin");
moonIcon?.classList.add("hidden");
moonIcon?.classList.remove("moonIconSpin");

const savedTheme = localStorage.getItem("theme");

if (savedTheme === "dark") {
  document.documentElement.classList.add("dark");
  sunIcon?.classList.remove("hidden"); // show sun only
} else {
  document.documentElement.classList.remove("dark");
  moonIcon?.classList.remove("hidden"); // show moon only
}

toggle?.addEventListener("click", () => {

  // trigger button rotation/fade animation
  toggle.classList.add("animating");

  const isDark = document.documentElement.classList.toggle("dark");

  if (isDark) {
    // DARK MODE: show sun, hide moon
    sunIcon?.classList.remove("hidden");
    moonIcon?.classList.add("hidden");

    // spin sun only
    sunIcon?.classList.add("moonIconSpin");
    setTimeout(() => sunIcon?.classList.remove("moonIconSpin"), 250);

    localStorage.setItem("theme", "dark");
  } else {
    // LIGHT MODE: show moon, hide sun
    sunIcon?.classList.add("hidden");
    moonIcon?.classList.remove("hidden");

    // spin moon only
    moonIcon?.classList.add("moonIconSpin");
    setTimeout(() => moonIcon?.classList.remove("moonIconSpin"), 250);

    localStorage.setItem("theme", "light");
  }

  // remove main animating class after button animation
  setTimeout(() => {
    toggle.classList.remove("animating");
  }, 450);

});


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
