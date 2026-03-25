document.addEventListener("DOMContentLoaded", () => {
  // 1. Inject a bulletproof CSS class to guarantee the highlight stays
  const style = document.createElement("style");
  style.textContent = `
    .iep-persistent-highlight {
      background-color: rgba(37, 99, 235, 0.15) !important;
      border-radius: 6px !important;
      transition: background-color 0.4s ease !important;
      padding: 4px 8px !important;
      margin-left: -8px !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Calculate the sticky header height dynamically
  const header = document.querySelector(".iep-sticky-header-wrapper");
  const headerOffset = header ? header.offsetHeight + 24 : 80;

  // 3. The core smooth-scroll function
  const smoothScrollTo = (targetElement) => {
    const elementPosition = targetElement.getBoundingClientRect().top + window.scrollY;

    window.scrollTo({
      top: elementPosition - headerOffset,
      behavior: "smooth"
    });

    // Strip the highlight class from ANY previously highlighted elements
    document.querySelectorAll(".iep-persistent-highlight").forEach((el) => {
      el.classList.remove("iep-persistent-highlight");
    });

    // Lock the highlight onto the new target using the injected class
    targetElement.classList.add("iep-persistent-highlight");
  };

  // 4. Intercept all internal Table of Contents links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const targetId = anchor.getAttribute("href").substring(1);
      const target = document.getElementById(targetId);

      if (target) {
        e.preventDefault();
        history.pushState(null, null, `#${targetId}`);
        smoothScrollTo(target);
      }
    });
  });

  // 5. Handle incoming links (e.g., clicking "?" in the Settings Panel)
  if (window.location.hash) {
    const targetId = window.location.hash.substring(1);
    const target = document.getElementById(targetId);

    if (target) {
      setTimeout(() => smoothScrollTo(target), 150);
    }
  }
});
