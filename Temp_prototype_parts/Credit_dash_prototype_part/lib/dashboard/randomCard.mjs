const cardTitles = [
  "Aurora credit",
  "Mint reserve",
  "Studio float",
  "Launch buffer",
  "Signal fund",
  "North star",
  "Tempo pool",
  "Market spark",
  "Orbit stash",
  "Ledger lift",
];

const cardColours = [
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#84cc16",
  "#eab308",
  "#6366f1",
];

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function createRandomCardData() {
  return {
    title: pickRandom(cardTitles),
    number: Math.floor(Math.random() * 900) + 100,
    colour: pickRandom(cardColours),
  };
}
