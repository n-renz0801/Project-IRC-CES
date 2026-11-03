/* Linked signatory fields for OPCRF I-IV (irc8a-irc8d).

   Every <input data-sig="..."> is one view of a single shared record:
     ratee-name      -> report header  nameOfEmployee    (capitals)
     ratee-position  -> report header  positionOfEmployee
     rater-name      -> report header  nameOfRater       (capitals)
     authority-name  -> approving authority name         (capitals)
   These inputs exist both in the signatory block (the `signatories` macro in
   _macros.html) and, on OPCRF I, in "Form details". Editing one updates every
   other input for the same field on the page right away; because the values
   live on the server, every other OPCRF page shows the change when it loads,
   and pages already open in another browser tab update live through a
   BroadcastChannel. Positions of the rater / approving authority are fixed
   on the server. A blank field falls back to its default. */
(function () {
  const inputs = Array.from(document.querySelectorAll("input[data-sig]"));
  if (!inputs.length) return;

  const HEADER = "/api/irc8a/report-header";
  const AUTHORITY = "/api/irc8a/approving-authority";
  const FIELDS = {
    "ratee-name": { url: HEADER, key: "nameOfEmployee", upper: true },
    "ratee-position": { url: HEADER, key: "positionOfEmployee" },
    "rater-name": { url: HEADER, key: "nameOfRater", upper: true },
    "authority-name": { url: AUTHORITY, key: "name", upper: true },
  };

  const channel =
    "BroadcastChannel" in window
      ? new BroadcastChannel("opcrf-signatories")
      : null;

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* no JSON body */
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Could not save. Please try again.",
      );
    }
    return data || {};
  }

  const fmt = (name, v) => {
    const s = String(v == null ? "" : v);
    return FIELDS[name].upper ? s.toUpperCase() : s;
  };

  // Puts a value into every input for this field (skipping one being typed in).
  function setAll(name, value, except) {
    inputs.forEach((inp) => {
      if (inp.dataset.sig !== name) return;
      inp.dataset.saved = fmt(name, value);
      if (inp !== except) inp.value = fmt(name, value);
    });
    document.dispatchEvent(
      new CustomEvent("sig:change", {
        detail: { name, value: fmt(name, value) },
      }),
    );
  }

  // Initial load: one GET per endpoint, then fill every field it provides.
  const names = Object.keys(FIELDS).filter((n) =>
    inputs.some((i) => i.dataset.sig === n),
  );
  [...new Set(names.map((n) => FIELDS[n].url))].forEach((url) => {
    call("GET", url)
      .then((d) =>
        names.forEach((n) => {
          if (FIELDS[n].url === url) setAll(n, d[FIELDS[n].key]);
        }),
      )
      .catch(() => {
        /* leave blank; the page still works */
      });
  });

  inputs.forEach((inp) => {
    const name = inp.dataset.sig;
    const cfg = FIELDS[name];
    if (!cfg) return;

    // Names are kept in capitals as the person types (cursor preserved).
    if (cfg.upper) {
      inp.addEventListener("input", () => {
        const s = inp.selectionStart;
        const e = inp.selectionEnd;
        inp.value = inp.value.toUpperCase();
        try {
          inp.setSelectionRange(s, e);
        } catch (err) {
          /* not supported */
        }
      });
    }

    // Mirror what is being typed into the linked inputs immediately.
    inp.addEventListener("input", () => {
      inputs.forEach((other) => {
        if (other !== inp && other.dataset.sig === name)
          other.value = inp.value;
      });
    });

    inp.addEventListener("change", async () => {
      const value = inp.value.trim();
      if (fmt(name, value) === (inp.dataset.saved || "")) return;
      try {
        const d = await call("POST", cfg.url, { [cfg.key]: value });
        const saved = d[cfg.key];
        inp.value = fmt(name, saved);
        setAll(name, saved);
        if (channel) channel.postMessage({ name, value: saved });
      } catch (err) {
        alert(err.message);
      }
    });

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inp.blur();
    });
  });

  // A change made on another OPCRF page that is open in this browser.
  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data || {};
      if (FIELDS[m.name]) setAll(m.name, m.value);
    };
  }
})();
