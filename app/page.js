import { EditorShell } from "@/components/editor-shell";
import { createDefaultProject } from "@/lib/project";
import sampleDraft from "@/samples/aaj-se-teri.json";

const WORD_BANK = {
  "आज": { gloss: "today", roman: "aaj" },
  "से": { gloss: "from", roman: "se" },
  "तेरी": { gloss: "your", roman: "teri" },
  "तेरे": { gloss: "your", roman: "tere" },
  "तेरा": { gloss: "yours", roman: "tera" },
  "सारी": { gloss: "all", roman: "saari" },
  "गलियां": { gloss: "streets", roman: "galiyan" },
  "गलियों": { gloss: "streets", roman: "galiyon" },
  "मेरी": { gloss: "my", roman: "meri" },
  "मेरा": { gloss: "my", roman: "mera" },
  "मेरे": { gloss: "my", roman: "mere" },
  "हो": { gloss: "be", roman: "ho" },
  "गई": { gloss: "became", roman: "gayi" },
  "गया": { gloss: "became", roman: "gaya" },
  "घर": { gloss: "home", roman: "ghar" },
  "खुशियां": { gloss: "happiness", roman: "khushiyan" },
  "खुशियों": { gloss: "happiness", roman: "khushiyon" },
  "गम": { gloss: "sorrow", roman: "gam" },
  "घम": { gloss: "sorrow", roman: "gam" },
  "ओ": { gloss: "oh", roman: "o" },
  "कंधे": { gloss: "shoulder", roman: "kandhe" },
  "कांधे": { gloss: "shoulder", roman: "kaandhe" },
  "का": { gloss: "of", roman: "ka" },
  "है": { gloss: "is", roman: "hai" },
  "सीने": { gloss: "chest", roman: "seene" },
  "में": { gloss: "in", roman: "mein" },
  "बिजली": { gloss: "electricity", roman: "bijli" },
  "जो": { gloss: "that", roman: "jo" },
  "बिल": { gloss: "bill", roman: "bill" },
  "ख्वाबों": { gloss: "dreams", roman: "khwabon" },
  "खाबों": { gloss: "dreams", roman: "khwabon" },
  "अंबर": { gloss: "sky", roman: "ambar" },
  "अम्बर": { gloss: "sky", roman: "ambar" },
  "समंदर": { gloss: "ocean", roman: "samandar" },
  "पिन": { gloss: "pin", roman: "pin" },
  "कोड": { gloss: "code", roman: "code" },
  "नंबर": { gloss: "number", roman: "number" },
  "माथे": { gloss: "forehead", roman: "maathe" },
  "के": { gloss: "of", roman: "ke" },
  "को": { gloss: "to", roman: "ko" },
  "मैं": { gloss: "I", roman: "main" },
  "तिलक": { gloss: "tilak", roman: "tilak" },
  "लगा": { gloss: "apply", roman: "laga" },
  "बाली": { gloss: "earring", roman: "baali" },
  "की": { gloss: "of", roman: "ki" },
  "छन": { gloss: "jingle", roman: "chhan" },
  "छुन": { gloss: "jingle", roman: "chhun" },
  "दिल": { gloss: "heart", roman: "dil" },
  "छोटी": { gloss: "little", roman: "chhoti" },
  "सी": { gloss: "small", roman: "si" },
  "तू": { gloss: "you", roman: "tu" },
  "तु": { gloss: "you", roman: "tu" },
  "नदिया": { gloss: "river", roman: "nadiya" },
  "बहा": { gloss: "flow", roman: "baha" },
  "देना": { gloss: "let go", roman: "dena" },
  "भूलों": { gloss: "mistakes", roman: "bhoolon" },
  "फूलों": { gloss: "flowers", roman: "phoolon" },
  "अपनी": { gloss: "my own", roman: "apni" },
  "शर्ट": { gloss: "shirt", roman: "shirt" },
  "पहनूँगा": { gloss: "will wear", roman: "pehnunga" },
};

function tokenize(value) {
  return String(value ?? "")
    .replace(/[.,!?;:()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function buildSampleWords(line) {
  const translationTokens = tokenize(line.translation);

  return tokenize(line.original).map((text, wordIndex) => {
    const known = WORD_BANK[text];

    return {
      gloss: known?.gloss ?? translationTokens[wordIndex] ?? "",
      roman: known?.roman ?? text,
      text,
    };
  });
}

function createReferenceSampleProject() {
  return createDefaultProject({
    ...sampleDraft,
    meta: {
      artist: "",
      title: "",
    },
    audio: {
      duration: 320.388934,
      endOffset: 320.388934,
      name: "Aaj-Se-Teri-Lyrical-Padman-Aksha.mp3",
      startOffset: 0,
    },
    lines: sampleDraft.lines.map((line, index) => ({
      ...line,
      id: line.id ?? `line-${index + 1}`,
      start:
        typeof line.start === "number"
          ? line.start
          : Number((41.44 + index * 5.85).toFixed(2)),
      words: buildSampleWords(line),
    })),
  });
}

export default function Home() {
  const sampleProject = createReferenceSampleProject();

  return <EditorShell project={sampleProject} />;
}
