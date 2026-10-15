// Best Asistent — frontend widget.
// Ovo je isti otporan, samostalni widget (sve stilove postavlja direktno u
// JS, bez <style>/<link>, sa ensureMounted() petljom) kao i ranija verzija —
// jedina razlika je da ODGOVORE SADA DAJE PRAVI BACKEND (Node/Express +
// Claude API + baza znanja), a ne lista reči lokalno u pretraživaču.
//
// Podešavanje adrese backend-a (uradi JEDNO od ovoga PRE učitavanja ovog fajla):
//   <script>window.BEST_ASISTENT_API_URL = "https://tvoj-backend.onrender.com";</script>
//   <script src=".../bot_widget.js"></script>
// ili dodaj atribut na sam <script> tag:
//   <script src=".../bot_widget.js" data-api-url="https://tvoj-backend.onrender.com"></script>
// Ako se ništa ne podesi, widget zove "/api/chat" na ISTOM domenu gde je
// učitan (ima smisla samo ako backend i sajt dele domen — inače MORA da se
// podesi puna adresa backend-a).
(function () {
  "use strict";

  var CURRENT_SCRIPT = document.currentScript;

  function resolveApiBase() {
    if (window.BEST_ASISTENT_API_URL) return window.BEST_ASISTENT_API_URL.replace(/\/+$/, "");
    if (CURRENT_SCRIPT && CURRENT_SCRIPT.getAttribute("data-api-url")) {
      return CURRENT_SCRIPT.getAttribute("data-api-url").replace(/\/+$/, "");
    }
    return ""; // same-origin fallback
  }
  var API_BASE = resolveApiBase();
  var CHAT_URL = API_BASE + "/api/chat";

  // The host page may run a CSS-in-JS / styling runtime that purges <style>
  // and <link> tags it doesn't recognize from <head> (confirmed on the
  // bundled-export host: an injected <div> survives re-renders, but a
  // sibling <style> tag gets stripped). So every element below is styled
  // with inline style properties set directly in JS — nothing for that
  // mechanism to find and delete. No external font either; plain system
  // stack only.

  var dark = false;
  try { dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}

  var C = dark ? {
    bg: "#1a2129", text: "#eef1f3", muted: "#93a0ab",
    accent: "#e8584c", accentContrast: "#1a1006", border: "#2b3440",
    bubbleBot: "#242d37", bubbleUser: "#e8584c", bubbleUserText: "#1a1006"
  } : {
    bg: "#ffffff", text: "#17212b", muted: "#5b6672",
    accent: "#D3261C", accentContrast: "#ffffff", border: "#e3dede",
    bubbleBot: "#f3eeee", bubbleUser: "#17212b", bubbleUserText: "#f4f5f3"
  };
  var FONT = "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  var FONT_DISPLAY = "Oswald, 'Segoe UI', sans-serif";

  function style(el, props) {
    for (var k in props) { if (props.hasOwnProperty(k)) el.style[k] = props[k]; }
  }
  function el(tag, props, styleProps) {
    var e = document.createElement(tag);
    if (props) { for (var k in props) { if (props.hasOwnProperty(k)) e[k] = props[k]; } }
    if (styleProps) style(e, styleProps);
    return e;
  }
  function svgIcon(pathD, size) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size || 24);
    svg.setAttribute("height", size || 24);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  var GREETING = "Zdravo! 👋 Ja sam Best Asistent, pomažem oko tehničkog pregleda, registracije i osiguranja vozila u Autocentru Best. Kako mogu da pomognem?";
  var SUGGESTIONS = ["Šta mi treba pre dolaska?", "Koja su radna vremena?", "Kako da zakažem termin?", "Kako se može platiti?"];
  var OFFLINE_MSG = "Trenutno ne mogu da se povežem sa serverom. Pokušajte ponovo za koji trenutak, ili pozovite 063 819-31-83.";

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  // Backend replies are plain text (possibly multi-line); render newlines as
  // line breaks without allowing any HTML the model might produce.
  function textToHtml(s) {
    return escapeHtml(s).replace(/\n/g, "<br>");
  }

  // ---------- build the widget DOM (all styles inline) ----------
  function buildWidget() {
    var root = el("div", { id: "ba-root" }, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483000",
      fontFamily: FONT
    });

    var launcher = el("button", { id: "ba-launcher", type: "button" }, {
      position: "fixed",
      right: "max(22px, env(safe-area-inset-right,0px))",
      bottom: "max(22px, env(safe-area-inset-bottom,0px))",
      width: "58px", height: "58px", borderRadius: "50%",
      background: C.accent, color: C.accentContrast, border: "none", cursor: "pointer",
      boxShadow: "0 10px 24px -8px rgba(0,0,0,.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "auto"
    });
    launcher.setAttribute("aria-label", "Otvori chat");
    launcher.appendChild(svgIcon("M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z", 26));
    var dot = el("span", {}, {
      position: "absolute", top: "4px", right: "4px", width: "11px", height: "11px",
      borderRadius: "50%", background: "#2fa35a", border: "2px solid " + C.bg
    });
    launcher.appendChild(dot);

    var panel = el("div", { id: "ba-panel" }, {
      display: "none",
      position: "fixed",
      right: "max(18px, env(safe-area-inset-right,0px))",
      bottom: "max(92px, calc(92px + env(safe-area-inset-bottom,0px)))",
      width: "min(360px, calc(100vw - 32px))",
      height: "min(560px, calc(100vh - 140px))",
      background: C.bg, border: "1px solid " + C.border, borderRadius: "16px",
      flexDirection: "column",
      boxShadow: "0 20px 50px -12px rgba(0,0,0,.35)", overflow: "hidden",
      pointerEvents: "auto"
    });

    var header = el("div", {}, {
      background: C.text, color: C.bg, padding: "14px 16px",
      display: "flex", alignItems: "center", gap: "10px", flexShrink: "0"
    });
    var mark = el("div", { textContent: "AB" }, {
      width: "30px", height: "30px", borderRadius: "8px", background: C.accent, color: C.accentContrast,
      display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700",
      fontFamily: FONT_DISPLAY, flexShrink: "0", fontSize: "13px"
    });
    var titles = el("div", {}, { minWidth: "0", flex: "1" });
    var t1 = el("div", { textContent: "Best Asistent" }, { fontWeight: "700", fontSize: "15px", fontFamily: FONT_DISPLAY });
    var t2wrap = el("div", {}, { fontSize: "12px", opacity: "0.8", display: "flex", alignItems: "center", gap: "5px" });
    var t2dot = el("span", {}, { width: "7px", height: "7px", borderRadius: "50%", background: "#2fa35a", display: "inline-block" });
    var t2text = document.createTextNode("Dostupan 24/7");
    t2wrap.appendChild(t2dot); t2wrap.appendChild(t2text);
    titles.appendChild(t1); titles.appendChild(t2wrap);
    var closeBtn = el("button", { id: "ba-close", type: "button" }, {
      background: "none", border: "none", color: "inherit", opacity: "0.8", cursor: "pointer", padding: "4px"
    });
    closeBtn.setAttribute("aria-label", "Zatvori");
    closeBtn.appendChild(svgIcon("M18 6 6 18M6 6l12 12", 18));
    header.appendChild(mark); header.appendChild(titles); header.appendChild(closeBtn);

    var feed = el("div", { id: "ba-feed" }, {
      flex: "1", overflowY: "auto", padding: "14px", display: "flex",
      flexDirection: "column", gap: "10px", minWidth: "0"
    });

    var suggestions = el("div", { id: "ba-suggestions" }, {
      display: "flex", flexWrap: "wrap", gap: "6px", padding: "0 14px 10px", flexShrink: "0"
    });

    var composer = el("div", { id: "ba-composer" }, {
      display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid " + C.border, flexShrink: "0"
    });
    var input = el("input", { id: "ba-input", type: "text", placeholder: "Postavite pitanje…", autocomplete: "off" }, {
      flex: "1", minWidth: "0", border: "1px solid " + C.border, background: C.bg, color: C.text,
      borderRadius: "10px", padding: "10px 12px", fontSize: "14px", fontFamily: FONT
    });
    var sendBtn = el("button", { id: "ba-send", type: "button" }, {
      background: C.accent, color: C.accentContrast, border: "none", borderRadius: "10px",
      width: "40px", flexShrink: "0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
    });
    sendBtn.setAttribute("aria-label", "Pošalji");
    sendBtn.appendChild(svgIcon("m22 2-7 20-4-9-9-4Z", 18));
    composer.appendChild(input); composer.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(feed);
    panel.appendChild(suggestions);
    panel.appendChild(composer);

    root.appendChild(launcher);
    root.appendChild(panel);
    return root;
  }

  function addMsg(feed, role, html) {
    var isUser = role === "user";
    var div = el("div", { innerHTML: html }, {
      maxWidth: "85%", padding: "10px 13px", borderRadius: "14px", fontSize: "14px",
      lineHeight: "1.48", minWidth: "0", overflowWrap: "break-word",
      background: isUser ? C.bubbleUser : C.bubbleBot,
      color: isUser ? C.bubbleUserText : C.text,
      alignSelf: isUser ? "flex-end" : "flex-start",
      borderBottomRightRadius: isUser ? "4px" : "14px",
      borderBottomLeftRadius: isUser ? "14px" : "4px"
    });
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
    return div;
  }
  function typingDots() {
    var wrap = el("div", {}, { display: "flex", gap: "4px", padding: "4px 2px" });
    var dots = [];
    for (var i = 0; i < 3; i++) {
      var d = el("span", {}, { width: "6px", height: "6px", borderRadius: "50%", background: C.muted, opacity: "0.3" });
      dots.push(d);
      wrap.appendChild(d);
    }
    var i2 = 0;
    var timer = setInterval(function () {
      dots.forEach(function (d, idx) { d.style.opacity = (idx === i2 % 3) ? "1" : "0.3"; });
      i2++;
    }, 220);
    wrap._stopAnim = function () { clearInterval(timer); };
    return wrap;
  }

  function wireUp(root) {
    var feed = root.querySelector("#ba-feed");
    var panel = root.querySelector("#ba-panel");
    var launcher = root.querySelector("#ba-launcher");
    var input = root.querySelector("#ba-input");
    var sendBtn = root.querySelector("#ba-send");
    var suggestionsBox = root.querySelector("#ba-suggestions");
    var closeBtn = root.querySelector("#ba-close");

    // Short rolling history sent with each request so the backend/LLM has
    // conversational context (last 6 turns are kept server-side anyway).
    var history = [];

    function askBackend(userText) {
      var typingWrap = addMsg(feed, "bot", "");
      typingWrap.appendChild(typingDots());

      fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history: history })
      })
        .then(function (resp) {
          return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
        })
        .then(function (result) {
          if (typingWrap._stopAnim) typingWrap._stopAnim();
          typingWrap.remove();

          if (!result.ok || !result.data || typeof result.data.reply !== "string") {
            addMsg(feed, "bot", textToHtml(OFFLINE_MSG));
            return;
          }
          var reply = result.data.reply;
          var html = textToHtml(reply);
          if (result.data.escalated) {
            html += '<span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:' + C.accent + ';margin-top:8px;font-weight:700;">Prosleđeno osoblju</span>';
          }
          addMsg(feed, "bot", html);

          history.push({ role: "user", content: userText });
          history.push({ role: "assistant", content: reply });
          if (history.length > 12) history = history.slice(-12);
        })
        .catch(function () {
          if (typingWrap._stopAnim) typingWrap._stopAnim();
          typingWrap.remove();
          addMsg(feed, "bot", textToHtml(OFFLINE_MSG));
        });
    }

    function handleSend(text) {
      text = (text || "").trim();
      if (!text) return;
      addMsg(feed, "user", escapeHtml(text));
      input.value = "";
      askBackend(text);
    }
    sendBtn.addEventListener("click", function () { handleSend(input.value); });
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") handleSend(input.value); });

    SUGGESTIONS.forEach(function (s) {
      var chip = el("button", { type: "button", textContent: s }, {
        fontSize: "12px", padding: "6px 11px", borderRadius: "999px", border: "1px solid " + C.border,
        background: C.bg, color: C.text, cursor: "pointer"
      });
      chip.addEventListener("click", function () { handleSend(this.textContent); });
      suggestionsBox.appendChild(chip);
    });

    var opened = false;
    function openPanel() {
      panel.style.display = "flex";
      if (!opened) { addMsg(feed, "bot", escapeHtml(GREETING)); opened = true; }
      input.focus();
    }
    launcher.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", function () { panel.style.display = "none"; });
  }

  function ensureMounted() {
    if (!document.body) return;
    if (document.getElementById("ba-root")) return; // already mounted and wired
    var root = buildWidget();
    document.body.appendChild(root);
    wireUp(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureMounted);
  } else {
    ensureMounted();
  }
  window.addEventListener("load", ensureMounted);
  setInterval(ensureMounted, 400);
})();
