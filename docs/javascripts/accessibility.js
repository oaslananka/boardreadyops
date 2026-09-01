(() => {
  function setMissingAttribute(element, name, value) {
    if (element && !element.hasAttribute(name)) {
      element.setAttribute(name, value);
    }
  }

  function ensureSubmitButtons() {
    for (const form of document.querySelectorAll("form")) {
      if (!form.querySelector('button[type="submit"], input[type="submit"], input[type="image"]')) {
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "boardreadyops-visually-hidden";
        submit.textContent = "Submit";
        form.appendChild(submit);
      }
    }
  }

  function patchSearch() {
    for (const toggle of document.querySelectorAll('input#__search, input[data-md-toggle="search"]')) {
      setMissingAttribute(toggle, "aria-label", "Open documentation search");
    }
    for (const dialog of document.querySelectorAll('.md-search[role="dialog"]')) {
      setMissingAttribute(dialog, "aria-label", "Documentation search");
    }
  }

  function patchTocToggle() {
    for (const toggle of document.querySelectorAll('input#__toc, input[data-md-toggle="toc"]')) {
      setMissingAttribute(toggle, "aria-label", "Toggle table of contents");
    }
  }

  function patchScrollableCode() {
    for (const element of document.querySelectorAll(
      ".highlight, .highlight code, .md-typeset pre, .md-typeset pre > code",
    )) {
      setMissingAttribute(element, "tabindex", "0");
      setMissingAttribute(element, "title", "Scrollable code block");
    }
  }

  function patchScrollableRegions() {
    for (const element of document.querySelectorAll(".md-typeset__scrollwrap, .md-typeset__table")) {
      if (element.scrollWidth > element.clientWidth) {
        setMissingAttribute(element, "tabindex", "0");
        setMissingAttribute(element, "role", "region");
        setMissingAttribute(element, "aria-label", "Scrollable table");
      }
    }
  }

  function patchAccessibility() {
    ensureSubmitButtons();
    patchSearch();
    patchTocToggle();
    patchScrollableCode();
    patchScrollableRegions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchAccessibility, { once: true });
  } else {
    patchAccessibility();
  }
})();
