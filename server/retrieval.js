// Tiny, dependency-free BM25 retrieval over the knowledge base chunks.
// Good enough for a few hundred short chunks — no vector DB or embedding
// API needed, so there's no extra cost or moving part beyond the one
// Claude API call per chat message.

const fs = require("fs");
const path = require("path");

const CHUNKS_PATH = path.join(__dirname, "kb", "chunks.json");
const SITE_BOOST = 2.5;

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/š/g, "s").replace(/č|ć/g, "c").replace(/ž/g, "z").replace(/đ/g, "dj")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Serbian is heavily inflected (radno/radna/radnog/radnim, vreme/vremena/
// vremenu...), so matching on exact words misses obvious paraphrases like
// "radna vremena" when the knowledge base says "radno vreme". There's no
// real Serbian stemmer here (no extra dependency), so this uses a crude
// but effective trick: truncate longer words to their first 4 letters,
// which collapses most common noun/adjective endings onto the same stem
// (radno/radna/radnog -> "radn", vreme/vremena/vremenu -> "vrem") without
// pulling in a library. Short words are left alone since 4 letters would
// already be most or all of them.
function stem(word) {
  return word.length > 4 ? word.slice(0, 4) : word;
}

function tokenize(s) {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length > 2)
    .map(stem);
}

class BM25Index {
  constructor(chunks) {
    this.chunks = chunks;
    this.k1 = 1.5;
    this.b = 0.75;
    this.docs = chunks.map((c) => tokenize(c.title + " " + c.text));
    this.N = this.docs.length;
    this.avgdl = this.docs.reduce((a, d) => a + d.length, 0) / Math.max(1, this.N);

    this.df = new Map(); // term -> number of docs containing it
    this.tf = this.docs.map((doc) => {
      const counts = new Map();
      doc.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
      return counts;
    });
    this.tf.forEach((counts) => {
      counts.forEach((_, term) => {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      });
    });
    this.idf = new Map();
    this.df.forEach((df, term) => {
      const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
      this.idf.set(term, idf);
    });
  }

  search(query, topK = 6) {
    const qTerms = tokenize(query);
    const scores = this.chunks.map((_, i) => {
      const docLen = this.docs[i].length || 1;
      let score = 0;
      qTerms.forEach((term) => {
        const idf = this.idf.get(term);
        if (!idf) return;
        const f = this.tf[i].get(term) || 0;
        if (f === 0) return;
        const numerator = f * (this.k1 + 1);
        const denominator = f + this.k1 * (1 - this.b + (this.b * docLen) / this.avgdl);
        score += idf * (numerator / denominator);
      });
      // The 11 short site-FAQ chunks (radno vreme, kontakt, zakazivanje...)
      // answer most everyday customer questions directly, but they're
      // heavily outnumbered by ~217 Pravilnik articles that share common
      // Serbian words, which was drowning out the right FAQ chunk in the
      // combined ranking. Give the site chunks a boost so a practical
      // question favors the practical answer; legal questions still surface
      // Pravilnik articles since those simply have no competing site chunk.
      if (this.chunks[i].source.startsWith("sajt")) score *= SITE_BOOST;
      return { idx: i, score };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores
      .slice(0, topK)
      .filter((s) => s.score > 0)
      .map((s) => ({ ...this.chunks[s.idx], score: s.score }));
  }
}

function loadIndex() {
  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));
  return new BM25Index(chunks);
}

module.exports = { loadIndex, tokenize, normalize };
