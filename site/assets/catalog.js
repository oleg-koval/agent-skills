(() => {
  "use strict";

  const CONSENT_KEY = "skills-analytics-consent-v1";
  const DATA_LAYER = "skillsDataLayer";
  const SITE_AREA = "skills";
  const PRODUCTION_HOST = "skills.olegkoval.com";
  const measurementId = document.body.dataset.gaMeasurementId;
  let analyticsEnabled = false;
  let analyticsLoaded = false;

  const getConsent = () => {
    try {
      return window.localStorage.getItem(CONSENT_KEY);
    } catch {
      return null;
    }
  };

  const setConsent = (value) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Analytics remains session-only if storage is unavailable.
    }
  };

  const skillsGtag = function () {
    window[DATA_LAYER] = window[DATA_LAYER] || [];
    window[DATA_LAYER].push(arguments);
  };

  const loadAnalytics = () => {
    analyticsEnabled = true;
    if (analyticsLoaded || !measurementId) return;
    analyticsLoaded = true;

    window[DATA_LAYER] = window[DATA_LAYER] || [];
    window.skillsGtag = skillsGtag;
    skillsGtag("js", new Date());
    skillsGtag("config", measurementId, {
      cookie_flags: "SameSite=None;Secure",
      page_location: `${window.location.origin}${window.location.pathname}`,
      page_path: window.location.pathname,
      site_area: SITE_AREA,
    });

    // Keep local previews and CI from polluting the production GA4 property.
    if (window.location.hostname !== PRODUCTION_HOST) return;

    const script = document.createElement("script");
    script.async = true;
    script.dataset.skillsAnalytics = "true";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}&l=${DATA_LAYER}`;
    document.head.appendChild(script);
  };

  const track = (name, params = {}) => {
    if (!analyticsEnabled || !analyticsLoaded) return;
    skillsGtag("event", name, {
      ...params,
      site_area: SITE_AREA,
      transport_type: "beacon",
    });
  };

  const banner = document.querySelector("[data-consent-banner]");

  const showConsent = () => {
    if (banner) banner.hidden = false;
  };

  const hideConsent = () => {
    if (banner) banner.hidden = true;
  };

  if (getConsent() === "accepted") loadAnalytics();
  else if (getConsent() !== "declined") window.setTimeout(showConsent, 700);

  document.querySelector("[data-consent-accept]")?.addEventListener("click", () => {
    setConsent("accepted");
    loadAnalytics();
    track("analytics_consent_update", { consent_choice: "accepted" });
    hideConsent();
  });

  document.querySelector("[data-consent-decline]")?.addEventListener("click", () => {
    if (analyticsLoaded) {
      skillsGtag("consent", "update", { analytics_storage: "denied" });
    }
    analyticsEnabled = false;
    setConsent("declined");
    hideConsent();
  });

  document.querySelector("[data-consent-open]")?.addEventListener("click", showConsent);

  const selectText = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  document.querySelectorAll("[data-copy]").forEach((button) => {
    const idle = button.textContent;
    let resetTimer = 0;

    button.addEventListener("click", async () => {
      const container = button.closest(".command, .install-line");
      const source = container?.querySelector("pre, code");
      if (!source) return;

      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        button.textContent = "Copied";
      } catch {
        selectText(source);
        button.textContent = "Selected";
      }

      clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        button.textContent = idle;
      }, 1500);

      const params = {};
      for (const [key, value] of Object.entries(button.dataset)) {
        if (!key.startsWith("analytics") || key === "analyticsEvent") continue;
        const param = key
          .replace(/^analytics/, "")
          .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
          .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        params[param] = value;
      }
      track(button.dataset.analyticsEvent || "command_copy", params);
    });
  });

  const search = document.getElementById("q");
  const grid = document.getElementById("grid");

  if (search && grid) {
    const cards = Array.from(grid.querySelectorAll(".skill-card"));
    const chips = Array.from(document.querySelectorAll(".chip"));
    const count = document.getElementById("count");
    const empty = document.getElementById("empty");
    const active = { category: null, adapter: null };
    let searchTimer = 0;

    const apply = () => {
      const needle = search.value.trim().toLowerCase();
      let shown = 0;

      for (const card of cards) {
        const matchesText = !needle || card.dataset.search.includes(needle);
        const matchesCategory = !active.category || card.dataset.category === active.category;
        const matchesAdapter =
          !active.adapter || card.dataset.adapters.split(" ").includes(active.adapter);
        const visible = matchesText && matchesCategory && matchesAdapter;
        card.hidden = !visible;
        if (visible) shown += 1;
      }

      count.textContent = shown === cards.length ? `${cards.length} skills` : `${shown} of ${cards.length} skills`;
      empty.hidden = shown !== 0;
      return shown;
    };

    search.addEventListener("input", () => {
      const shown = apply();
      window.clearTimeout(searchTimer);
      if (search.value.trim().length < 2) return;
      searchTimer = window.setTimeout(() => {
        track("catalog_search", { result_count: shown });
      }, 600);
    });

    for (const chip of chips) {
      chip.addEventListener("click", () => {
        const kind = chip.dataset.kind;
        const value = chip.dataset.value;
        const isActive = active[kind] === value;
        active[kind] = isActive ? null : value;

        for (const other of chips) {
          if (other.dataset.kind !== kind) continue;
          other.setAttribute("aria-pressed", String(!isActive && other.dataset.value === value));
        }

        const shown = apply();
        track("catalog_filter", {
          filter_type: kind,
          filter_value: isActive ? "all" : value,
          result_count: shown,
        });
      });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("q")) search.value = params.get("q");
    for (const kind of ["category", "adapter"]) {
      const value = params.get(kind);
      if (!value) continue;
      const chip = chips.find(
        (candidate) => candidate.dataset.kind === kind && candidate.dataset.value === value,
      );
      if (chip) {
        active[kind] = value;
        chip.setAttribute("aria-pressed", "true");
      }
    }
    apply();
  }

  document.querySelectorAll("[data-analytics-event]").forEach((element) => {
    if (element.matches("[data-copy]")) return;
    element.addEventListener("click", () => {
      const params = {};
      for (const [key, value] of Object.entries(element.dataset)) {
        if (!key.startsWith("analytics") || key === "analyticsEvent") continue;
        const param = key
          .replace(/^analytics/, "")
          .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
          .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        params[param] = value;
      }
      track(element.dataset.analyticsEvent, params);
    });
  });
})();
