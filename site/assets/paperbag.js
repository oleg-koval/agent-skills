/*
 * paperbag.js — progressive enhancement only. With JS off the page is a
 * complete, readable, fully linked catalog; everything below just adds the
 * p2output-era cursor theatrics and client-side filtering.
 */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* ------------------------------------------------ cursor-lit lettering */

  // Radius of the pointer's influence, in CSS pixels.
  const RADIUS = 130;

  const glyphs = [];

  const splitIntoGlyphs = (el) => {
    const text = el.textContent;
    // Keep the accessible name intact; the per-character spans are decorative.
    el.setAttribute("aria-label", text.trim());
    const frag = document.createDocumentFragment();
    // Characters are inline-block, which would otherwise let the browser break
    // a line mid-word. Wrapping each word keeps normal wrapping behaviour.
    for (const word of text.split(/(\s+)/)) {
      if (word === "") continue;
      if (/^\s+$/.test(word)) {
        frag.appendChild(document.createTextNode(word));
        continue;
      }
      const wrap = document.createElement("span");
      wrap.className = "w";
      wrap.setAttribute("aria-hidden", "true");
      for (const ch of word) {
        const span = document.createElement("span");
        span.className = "g";
        span.textContent = ch;
        wrap.appendChild(span);
      }
      frag.appendChild(wrap);
    }
    el.textContent = "";
    el.appendChild(frag);
    el.classList.add("reactive");
  };

  const measure = () => {
    for (const glyph of glyphs) {
      const r = glyph.el.getBoundingClientRect();
      // Page coordinates so scrolling never invalidates the cache.
      glyph.x = r.left + r.width / 2 + window.scrollX;
      glyph.y = r.top + r.height / 2 + window.scrollY;
      glyph.visible = r.width > 0;
    }
  };

  const initGlyphs = () => {
    if (!finePointer.matches) return;
    document.querySelectorAll("[data-reactive]").forEach((el) => {
      splitIntoGlyphs(el);
      el.querySelectorAll(".g").forEach((span) => {
        glyphs.push({ el: span, x: 0, y: 0, lit: 0, visible: true });
      });
    });
    if (glyphs.length) measure();
  };

  let pointerX = -9999;
  let pointerY = -9999;
  let queued = false;

  const paint = () => {
    queued = false;
    const top = window.scrollY - RADIUS;
    const bottom = window.scrollY + window.innerHeight + RADIUS;

    for (const glyph of glyphs) {
      let next = 0;
      if (glyph.visible && glyph.y > top && glyph.y < bottom) {
        const dx = glyph.x - pointerX;
        const dy = glyph.y - pointerY;
        const d = Math.hypot(dx, dy);
        if (d < RADIUS) {
          // Ease-out so the falloff reads as a soft brush, not a hard disc.
          const t = 1 - d / RADIUS;
          next = Math.round(t * t * 100) / 100;
        }
      }
      if (next !== glyph.lit) {
        glyph.lit = next;
        if (next === 0) glyph.el.style.removeProperty("--h");
        else glyph.el.style.setProperty("--h", String(next));
      }
    }
  };

  const onPointerMove = (event) => {
    pointerX = event.clientX + window.scrollX;
    pointerY = event.clientY + window.scrollY;
    document.body.style.setProperty("--mx", `${event.clientX}px`);
    document.body.style.setProperty("--my", `${event.clientY}px`);
    if (!queued && glyphs.length) {
      queued = true;
      requestAnimationFrame(paint);
    }
  };

  if (finePointer.matches && !reduceMotion.matches) {
    document.body.classList.add("pointer-fine");
    initGlyphs();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", measure);
  }

  /* -------------------------------------------------------- catalog filter */

  const q = document.getElementById("q");
  const grid = document.getElementById("grid");

  if (q && grid) {
    const cards = Array.from(grid.querySelectorAll(".card"));
    const chips = Array.from(document.querySelectorAll(".chip"));
    const countEl = document.getElementById("count");
    const emptyEl = document.getElementById("empty");
    const active = { category: null, adapter: null };

    const apply = () => {
      const needle = q.value.trim().toLowerCase();
      let shown = 0;

      for (const card of cards) {
        const matchesText = !needle || card.dataset.search.includes(needle);
        const matchesCat =
          !active.category || card.dataset.category === active.category;
        const matchesAdapter =
          !active.adapter ||
          card.dataset.adapters.split(" ").includes(active.adapter);
        const visible = matchesText && matchesCat && matchesAdapter;
        card.hidden = !visible;
        if (visible) shown += 1;
      }

      countEl.textContent =
        shown === cards.length
          ? `${cards.length} skills`
          : `${shown} of ${cards.length} skills`;
      emptyEl.hidden = shown !== 0;

      // Cards moved, so the glyph rect cache is stale.
      if (glyphs.length) requestAnimationFrame(measure);
    };

    q.addEventListener("input", apply);

    for (const chip of chips) {
      chip.addEventListener("click", () => {
        const kind = chip.dataset.kind;
        const value = chip.dataset.value;
        const isOn = active[kind] === value;
        active[kind] = isOn ? null : value;
        for (const other of chips) {
          if (other.dataset.kind !== kind) continue;
          other.setAttribute(
            "aria-pressed",
            String(!isOn && other.dataset.value === value),
          );
        }
        apply();
      });
    }

    // Deep links like /?q=release or /?category=marketing.
    const params = new URLSearchParams(window.location.search);
    if (params.get("q")) q.value = params.get("q");
    for (const kind of ["category", "adapter"]) {
      const value = params.get(kind);
      if (!value) continue;
      const chip = chips.find(
        (c) => c.dataset.kind === kind && c.dataset.value === value,
      );
      if (chip) {
        active[kind] = value;
        chip.setAttribute("aria-pressed", "true");
      }
    }
    apply();
  }

  /* ------------------------------------------------------- copy buttons */

  document.querySelectorAll(".copy").forEach((button) => {
    button.addEventListener("click", async () => {
      const pre = button.closest(".slab").querySelector("pre");
      try {
        await navigator.clipboard.writeText(pre.textContent.trim());
        const before = button.textContent;
        button.textContent = "copied";
        setTimeout(() => {
          button.textContent = before;
        }, 1400);
      } catch {
        // Clipboard blocked (insecure context, denied permission): select the
        // text so the reader can copy it by hand.
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  });
})();
