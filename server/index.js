require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { loadIndex } = require("./retrieval");

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "promeni-me";
// MOCK_MODE=1 lets the whole pipeline (rate limit, BM25 retrieval, escalation
// logging, the HTTP contract) be tested end-to-end without any AI key or
// cost. It must be off (0/unset) for real customer traffic.
const MOCK_MODE = process.env.MOCK_MODE === "1";
// Comma-separated list of origins allowed to call this API from the browser,
// e.g. "https://tehnickipregled.netlify.app,https://autocentarbest.rs"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Provider priority: Groq (free, no card, good enough for a client demo)
// first if its key is set, otherwise Anthropic/Claude (paid, best quality)
// if that key is set instead, otherwise MOCK_MODE for pure structural tests.
// This lets the SAME code demo for free today and move to Claude later just
// by changing which key is set in the environment — no code change needed.
const PROVIDER = GROQ_API_KEY ? "groq" : ANTHROPIC_API_KEY ? "anthropic" : null;

if (!PROVIDER && !MOCK_MODE) {
  console.warn(
    "[WARN] Nije podešen ni GROQ_API_KEY ni ANTHROPIC_API_KEY. /api/chat će vraćati grešku dok se jedan od njih ne podesi u environment-u (.env lokalno, ili podešavanja environment promenljivih na hostingu)."
  );
}
if (MOCK_MODE) {
  console.warn(
    "[MOCK_MODE] Radim BEZ pravog AI poziva — /api/chat vraća test-odgovor samo da bi se proverilo da server i baza znanja rade. Isključi MOCK_MODE pre puštanja uživo."
  );
} else if (PROVIDER === "groq") {
  console.log(`[PROVIDER] Groq (besplatno) — model: ${GROQ_MODEL}`);
} else if (PROVIDER === "anthropic") {
  console.log("[PROVIDER] Anthropic Claude (plaćeno) — model: claude-sonnet-4-5");
}

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
const index = loadIndex();

// Calls whichever provider is configured and returns the raw text the model
// produced (expected to be the {"answer":...,"confident":...} JSON string —
// parsing/fallback happens in the route handler, same for every provider).
async function callLLM(systemPrompt, userPrompt) {
  if (PROVIDER === "groq") {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      const err = new Error(`Groq API greška ${resp.status}: ${errText.slice(0, 300)}`);
      if (resp.status === 429) err.isRateLimit = true;
      throw err;
    }
    const data = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  }

  if (PROVIDER === "anthropic") {
    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return completion.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  throw new Error("Nijedan AI provajder nije podešen.");
}

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes("*") ? true : ALLOWED_ORIGINS,
  })
);

// Serves the widget script itself, so a client site can just point to
// "<ovaj-backend>/widget/bot_widget.js" instead of hosting the file separately.
app.use("/widget", express.static(path.join(__dirname, "..", "widget")));

// ---------- very small in-memory rate limiter (per IP) ----------
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20; // messages per minute per IP
const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateMap.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

// ---------- escalation log (unanswered / forwarded questions) ----------
const DATA_DIR = path.join(__dirname, "data");
const LOG_PATH = path.join(DATA_DIR, "unanswered.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, "[]", "utf-8");

function logUnanswered(entry) {
  try {
    const list = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
    list.unshift({ ...entry, t: new Date().toISOString() });
    fs.writeFileSync(LOG_PATH, JSON.stringify(list.slice(0, 500), null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write escalation log:", e);
  }
}

const SYSTEM_PROMPT = `Ti si "Best Asistent", chat bot na sajtu firme Autocentar Best iz Kaluđerice (Srbija),
koja se bavi tehničkim pregledom vozila, registracijom vozila i osiguranjem.

Pravila:
- Odgovaraj isključivo na srpskom jeziku, kratko, jasno i ljubazno.
- Odgovaraj SAMO na osnovu podataka datih u KONTEKST ispod. Ne izmišljaj cene, radno vreme, rokove ili zakonske odredbe koje nisu u kontekstu.
- Kad god citiraš zakonsku obavezu ili rok, možeš navesti koji član pravilnika je izvor, ako je dat u kontekstu.
- Ako kontekst ne sadrži dovoljno informacija da sigurno odgovoriš, nemoj nagađati. Umesto toga postavi "confident": false i u "answer" napiši kratko i iskreno da nisi siguran i da ćeš prosledити pitanje osoblju, i predloži da klijent pozove 063 819-31-83.
- Nikad ne daj konačan pravni savet kao da si advokat; za složena pravna pitanja predloži da se klijent obrati osoblju ili nadležnom organu.
- Budi topao i profesionalan, bez emotikona osim pokojeg uzdržanog, i bez dugih uvoda.

Uvek odgovori ISKLJUČIVO validnim JSON objektom, bez ikakvog teksta pre ili posle, u obliku:
{"answer": "<odgovor klijentu na srpskom>", "confident": true ili false}`;

// Groq's free tier caps tokens-per-minute (8000 TPM at time of writing), and
// a handful of retrieved Pravilnik articles plus a long chat history can
// easily blow past that in one single request — which looked like the bot
// "stops answering after 2 messages" (it was really a 429 rate-limit error,
// masked by the widget's generic offline message). Capping each context
// chunk's length and trimming history keeps a typical request well under
// that budget, with real Claude usage unaffected since this constant is
// generous for its much higher token limits.
const MAX_CHUNK_CHARS = 450;

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim() + "…";
}

function buildUserPrompt(message, history, contextChunks) {
  const contextText = contextChunks
    .map((c, i) => `[Izvor ${i + 1}: ${c.title}]\n${truncate(c.text, MAX_CHUNK_CHARS)}`)
    .join("\n\n---\n\n");

  const historyText = (history || [])
    .slice(-4)
    .map((h) => `${h.role === "user" ? "Klijent" : "Best Asistent"}: ${h.content}`)
    .join("\n");

  return `KONTEKST (odgovaraj samo na osnovu ovoga):
${contextText || "(nema relevantnog konteksta u bazi znanja)"}

${historyText ? "PRETHODNI RAZGOVOR:\n" + historyText + "\n" : ""}
NOVO PITANJE KLIJENTA: ${message}`;
}

app.post("/api/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Previše poruka u kratkom vremenu, pokušajte malo kasnije." });
  }

  const { message, history } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Nedostaje poruka." });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: "Poruka je predugačka." });
  }

  if (!PROVIDER && !MOCK_MODE) {
    return res.status(500).json({
      error: "Server nije podešen (nedostaje GROQ_API_KEY ili ANTHROPIC_API_KEY). Podesite environment promenljivu i restartujte server.",
    });
  }

  try {
    const contextChunks = index.search(message, 4);

    let parsed;
    if (MOCK_MODE) {
      // No real AI call — just prove the pipeline works: rate limiting,
      // retrieval, and the response contract the widget expects.
      parsed = {
        answer:
          contextChunks.length > 0
            ? `[MOCK] Pronašao sam ${contextChunks.length} relevantnih izvora (npr. "${contextChunks[0].title}"). Ovo je test-odgovor bez pravog AI poziva.`
            : `[MOCK] Nisam pronašao relevantan izvor u bazi znanja za: "${message}". Ovo je test-odgovor bez pravog AI poziva.`,
        confident: contextChunks.length > 0,
      };
    } else {
      const raw = await callLLM(SYSTEM_PROMPT, buildUserPrompt(message, history, contextChunks));

      try {
        // Be forgiving of accidental code fences around the JSON.
        const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        parsed = { answer: raw.trim() || "Izvinjavam se, došlo je do greške u obradi odgovora.", confident: false };
      }
    }

    if (!parsed.confident) {
      logUnanswered({
        question: message,
        answerGiven: parsed.answer,
        sourcesConsidered: contextChunks.map((c) => c.title),
      });
    }

    return res.json({
      reply: parsed.answer,
      escalated: !parsed.confident,
    });
  } catch (err) {
    console.error("Chat error:", err);
    if (err.isRateLimit) {
      // Groq's free tier has a per-minute token budget; this is the normal
      // way it signals "too much, too fast", not a broken server.
      return res.status(429).json({
        error: "Trenutno je previše upita u kratkom vremenu (besplatni AI limit). Pokušajte ponovo za par sekundi.",
      });
    }
    return res.status(500).json({ error: "Greška na serveru, pokušajte ponovo." });
  }
});

// ---------- simple admin view of escalated/unanswered questions ----------
app.get("/api/admin/unanswered", (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Neovlašćeno." });
  }
  const list = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  res.json(list);
});

// ---------- debug: inspect retrieval without spending an AI call ----------
// Lets us check which knowledge-base chunks a question retrieves (and with
// what score) directly on the deployed server, to tell a retrieval problem
// apart from an AI/model problem without burning a Groq request each time.
app.get("/api/admin/search", (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Neovlašćeno." });
  }
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Dodaj ?q=pitanje u URL." });
  const results = index.search(q, 6);
  res.json({
    query: q,
    results: results.map((r) => ({ title: r.title, source: r.source, score: r.score })),
  });
});

// Local-testing convenience: a bare demo page that loads the widget against
// this same server. Not meant for production use — the client's real site
// will load /widget/bot_widget.js on its own pages instead.
app.get("/demo", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "widget", "demo.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    kbChunks: index.chunks.length,
    provider: MOCK_MODE ? "mock" : PROVIDER || "none",
    mockMode: MOCK_MODE,
  });
});

app.listen(PORT, () => {
  console.log(`Best Asistent backend running on port ${PORT}`);
  console.log(`Knowledge base: ${index.chunks.length} chunks loaded`);
});
