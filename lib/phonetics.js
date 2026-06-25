// Coarse phonetic transliteration used as a script-robust MATCHING key — NOT for
// display (that uses the LLM romanization). It deliberately collapses the
// distinctions transcription models get wrong — retroflex vs dental stops, the
// three sibilants, aspiration, and vowel length — so near-miss spellings of the
// same sung word still match. It is applied identically to both sides of every
// comparison, so consistency matters far more than linguistic precision.
//
// Script-based, not language-based: the right transliteration is chosen from the
// characters themselves, so it works even when the source language is on
// "auto". New scripts (Han -> pinyin, Hangul -> romaja) plug in here later.

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

// Each Devanagari letter/matra -> a coarse Latin sound. Aspirated pairs collapse
// to their unaspirated base, retroflex collapses onto dental, and all sibilants
// onto "s"; vowel length is dropped.
const DEVANAGARI_MAP = {
  // independent vowels
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
  "ऋ": "ri", "ॠ": "ri", "ऌ": "li", "ए": "e", "ऐ": "e", "ओ": "o",
  "औ": "o", "ऑ": "o", "ऒ": "o", "ऎ": "e",
  // consonants
  "क": "k", "ख": "k", "ग": "g", "घ": "g", "ङ": "n",
  "च": "c", "छ": "c", "ज": "j", "झ": "j", "ञ": "n",
  "ट": "t", "ठ": "t", "ड": "d", "ढ": "d", "ण": "n",
  "त": "t", "थ": "t", "द": "d", "ध": "d", "न": "n",
  "प": "p", "फ": "p", "ब": "b", "भ": "b", "म": "m",
  "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
  "श": "s", "ष": "s", "स": "s", "ह": "h",
  // matras (dependent vowel signs)
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
  "े": "e", "ै": "e", "ो": "o", "ौ": "o", "ॉ": "o", "ॊ": "o", "ॆ": "e",
  // visarga -> h; avagraha -> drop
  "ः": "h", "ऽ": "",
};

function devanagariPhoneticKey(token) {
  let key = "";

  for (const char of token) {
    if (Object.prototype.hasOwnProperty.call(DEVANAGARI_MAP, char)) {
      key += DEVANAGARI_MAP[char];
    } else if (DEVANAGARI_RANGE.test(char)) {
      // Remaining Devanagari marks (nukta, anusvara, virama, etc.) carry no
      // reliable sound for matching — drop them.
      continue;
    } else {
      key += char.toLowerCase();
    }
  }

  return key;
}

// Map a token to its coarse phonetic matching key based on its script.
export function phoneticKey(token) {
  const value = String(token || "");

  if (DEVANAGARI_RANGE.test(value)) {
    return devanagariPhoneticKey(value);
  }

  return value.toLowerCase();
}
