import fs from "fs";
import express from "express";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import cors from "cors";

dotenv.config();

// Load system prompt
const systemMessage = fs.readFileSync("./system_prompt.md", "utf8");

const app = express();
app.use(express.json());
app.use(cors());

/* ------------------------------
   Pinecone Setup
------------------------------ */
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});
const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);

/* ------------------------------
   Embeddings
------------------------------ */
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "models/gemini-embedding-2"
});

/* ------------------------------
   Vector Store
------------------------------ */
let vectorStore;
async function initVectorStore() {
  vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex }
  );
  console.log("✅ Vector store initialized");
}

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "gemini-2.5-flash",
  temperature: 0
});

/* ------------------------------
   Helper Functions
------------------------------ */
function keywordScore(text, question) {
  const stopWords = new Set(["the", "and", "for", "are", "who", "what", "when", "where", "why", "how", "show", "list", "all", "me", "a", "an", "of", "to", "in", "on", "is", "it"]);
  const qWords = question
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
  const tWords = text.toLowerCase();
  let score = 0;
  qWords.forEach(word => {
    if (tWords.includes(word)) score++;
  });
  return score;
}
function extractEntityNames(text = "") {
  const matches =
    text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g);

  return [...new Set(matches || [])];
}

function cleanTextFormatting(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "") 
    .replace(/<[^>]*>/g, "")                    
    .replace(urlRegex, "")                      
    .replace(/\*/g, '')                         
    .replace(/\n\s*\n/g, '\n')                  
    .trim();
}

function isNoAnswer(text = "") {
  const lower = text.trim().toLowerCase();

  return (
    lower.includes("i don't have enough information") ||
    lower.includes("i couldn't find that information") ||
    lower.includes("not enough information")
  );
}

function noAnswerPayload() {
  return {
    response: "I couldn't find that information.",
    images: [],
    videos: [],
    links: []
  };
}

function normalizeUrl(url) {
  return url
    .trim()
    .replace(/[),.;\]]+$/g, "")
    .replace(/^["'(<[]+|["')>\]]+$/g, "");
}

function extractUrlsFromText(text = "") {
  const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
  return (text.match(urlRegex) || []).map(normalizeUrl).filter(isUsableUrl);
}

function isUsableUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!parsed.hostname.includes(".")) return false;
    if (/%$|%[0-9a-f]?$/i.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

function getYoutubeEmbedUrl(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    let id = "";

    if (parsed.hostname.includes("youtu.be")) {
      id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
        id = parsed.pathname.split("/").filter(Boolean)[1] || "";
      } else {
        id = parsed.searchParams.get("v") || "";
      }
    }

    return id ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

function classifyUrl(url) {
  const cleanUrl = normalizeUrl(url);
  if (!isUsableUrl(cleanUrl)) return null;
  const youtubeEmbed = getYoutubeEmbedUrl(cleanUrl);

  if (youtubeEmbed) return { kind: "video", item: { url: youtubeEmbed, type: "youtube" } };
  const videoMatch = cleanUrl.match(/\.(mp4|webm|ogg|mov|avi)(\?.*)?$/i);
  if (videoMatch) {
    const ext = videoMatch[1].toLowerCase();
    const mimeType = {
      mp4: "video/mp4",
      webm: "video/webm",
      ogg: "video/ogg",
      mov: "video/quicktime",
      avi: "video/x-msvideo"
    }[ext];

    return { kind: "video", item: { url: cleanUrl, type: "file", mimeType } };
  }
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(cleanUrl)) {
    return { kind: "image", item: { url: cleanUrl } };
  }
  return { kind: "link", item: { url: cleanUrl } };
}

function addClassifiedUrl(url, media, intent) {
  const classified = classifyUrl(url);
  if (!classified) return;

  if (classified.kind === "image" && intent.includeImages) {
    media.images.push(classified.item);
  } else if (classified.kind === "video" && intent.includeVideos) {
    media.videos.push(classified.item);
  } else if (classified.kind === "link" && intent.includeLinks) {
    media.links.push(classified.item);
  }
}

function extractCitedSourceIndexes(answer, sourceCount) {
  const cited = new Set();
  const citationRegex = /\[Source\s*(\d+)\]/gi;
  let match;

  while ((match = citationRegex.exec(answer)) !== null) {
    const index = Number(match[1]) - 1;
    if (Number.isInteger(index) && index >= 0 && index < sourceCount) {
      cited.add(index);
    }
  }

  return cited;
}

function getRelevantDocsForMedia(answer, rankedDocs) {
  const citedIndexes = extractCitedSourceIndexes(answer, rankedDocs.length);
  if (citedIndexes.size > 0) {
    return [...citedIndexes].map((index) => rankedDocs[index]);
  }

  return [];
}

function docsFromIndexes(indexes, rankedDocs) {
  return [...indexes]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < rankedDocs.length)
    .map((index) => rankedDocs[index]);
}

function collectMediaFromDocs(docs, intent) {
  const media = {
    images: [],
    videos: [],
    links: []
  };

  docs.forEach((doc) => {
    if (doc.metadata?.image_url) {
      addClassifiedUrl(doc.metadata.image_url, media, intent);
    }

    if (doc.metadata?.video_url) {
      addClassifiedUrl(doc.metadata.video_url, media, intent);
    }

    if (Array.isArray(doc.metadata?.links)) {
      doc.metadata.links.forEach((link) => {
        addClassifiedUrl(link, media, intent);
      });
    }

    if (doc.metadata?.link_url) {
      addClassifiedUrl(doc.metadata.link_url, media, intent);
    }
  });

  return {
    images: [...new Map(media.images.map((item) => [item.url, item])).values()],
    videos: [...new Map(media.videos.map((item) => [item.url, item])).values()],
    links: [...new Map(media.links.map((item) => [item.url, item])).values()]
  };
}

function limitMediaForClearResponse(media, intent) {
  return {
    images: intent.includeImages ? media.images.slice(0, 2) : [],
    videos: intent.includeVideos ? media.videos.slice(0, 2) : [],
    links: intent.includeLinks ? media.links.slice(0, 4) : []
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// async function invokeWithRetry(llm, prompt, retries = 2) { // Reduced retries
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       return await llm.invoke(prompt);
//     } catch (err) {
//       if (attempt === retries) throw err;
      
//       // If no specific retry time, wait only 2 seconds, not 60
//       const waitMs = 500;
//       console.log(`⚠️ Attempt ${attempt} failed. Retrying in ${waitMs / 1000}s...`);
//       await sleep(waitMs);
//     }
//   }
// }

async function ensureCitedAnswer(rawContent, context, question, rankedDocs) {
  if (extractCitedSourceIndexes(rawContent, rankedDocs.length).size > 0 || isNoAnswer(rawContent)) {
    return rawContent;
  }

  const repairPrompt = `${systemMessage}

The previous answer did not include source citations. Rewrite it using ONLY the context below.
Rules:
- Keep only facts directly supported by the context.
- Cite every factual sentence with [Source N].
- Do not add new facts.
- If the context does not support the answer, respond exactly: "I don't have enough information to answer that."

Context:
${context}

Question:
${question}

Previous answer:
${rawContent}

Corrected answer:`;

  const repaired = await invokeWithRetry(llm, repairPrompt, 1);
  return repaired?.content || rawContent;
}

function normalizeQuestion(question = "") {
  return question
    .toLowerCase()
    .replace(/accixon|accionn|acxion|axion|acction/gi, "accion")
    .replace(/ceeo|c e o/gi, "ceo")
    .trim();
}

/* ------------------------------
   RAG Endpoint
------------------------------ */
app.get("/", (req, res) => {
  console.log("✅ Health route hit");
  res.send("RAG API RUNNING");
});

app.post("/extractRAG", async (req, res) => {
  try {
    const originalQuestion = req.body.question;

    if (!originalQuestion) {
      return res.status(400).json({ error: "Question required" });
    }

    const question = normalizeQuestion(originalQuestion);
    console.log("❓ Question:", question);

    // --- NEW: INTENT DETECTION ---
    const wantsVideo = /video|youtube|watch|clip|play/i.test(question);
    const wantsImage = /image|photo|picture|look like|show me/i.test(question);
    const wantsLinks = /link|website|linkedin|profile|url/i.test(question);
    // If user didn't specify, we treat it as a general query
    const generalQuery = !wantsVideo && !wantsImage && !wantsLinks;
    const mediaIntent = {
      includeImages: wantsImage || generalQuery,
      includeVideos: wantsVideo || generalQuery,
      includeLinks: wantsLinks
    };

    /* Step 1: Retrieval */
    const isListQuery = /list|all|show|who are/i.test(question);
    const docs = await vectorStore.similaritySearch(question, 8);
    console.log("📚 Retrieved Docs:", docs.length);

    /* Step 2: Simplified Reranking */
    const rankedDocs = docs
      .map(doc => ({ doc, score: keywordScore(doc.pageContent, question) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(d => d.doc);

    const combinedText = rankedDocs
      .map(d => d.pageContent)
      .join(" ")
      .toLowerCase();

    const importantWords = question
      .split(/\W+/)
      .filter(w => w.length > 3);

    const hasRelevantMatch = importantWords.some(word =>
      combinedText.includes(word.toLowerCase())
    );

    if (!hasRelevantMatch) {
      return res.json(noAnswerPayload());
    }

    /* Step 3: Prompt Building */
    // const context = rankedDocs
    // .map((d, i) =>
    //   `[Source ${i + 1}: ${d.metadata?.filename || "Unknown"}]\n${d.pageContent}`
    // )
    // .join("\n\n");
    //   const mediaUrls = [
    //     d.metadata?.image_url,
    //     d.metadata?.video_url,
    //     ...(Array.isArray(d.metadata?.links) ? d.metadata.links : []),
    //     ...extractUrlsFromText(d.pageContent)
    //   ].filter(Boolean);

    //   const mediaContext = "";

    //   return `[Source ${i + 1}: ${d.metadata?.filename || "Unknown"}]\n${d.pageContent}${mediaContext}`;)
    // .join("\n\n");

    const context = rankedDocs
    .map((d, i) =>
      `[Source ${i + 1}: ${d.metadata?.filename || "Unknown"}]\n${d.pageContent}`
    )
    .join("\n\n");

    const prompt = `
    ${systemMessage}

    Rules:
    - Answer ONLY using context.
    - Never hallucinate.
    - Never guess.
    - Use clean conversational English.
    - For multiple people use bullet points.
    - Never use numbered lists.
    - Keep answers concise.
    - If unavailable say:
    "I couldn't find that information."

    Context:
    ${context}

    Question:
    ${question}

    Answer:
    `;

    /* Step 4: Generate Answer */
    const response = await llm.invoke(prompt);
    let rawContent = response?.content || "";
    // rawContent = await ensureCitedAnswer(rawContent, context, question, rankedDocs);

    if (isNoAnswer(rawContent)) {
      return res.json(noAnswerPayload());
    }

    /* Step 5: Final Clean Response */
    const rawCitedIndexes = extractCitedSourceIndexes(rawContent, rankedDocs.length);
    let finalAnswer = cleanTextFormatting(rawContent);

    if (finalAnswer && extractCitedSourceIndexes(finalAnswer, rankedDocs.length).size === 0 && rawCitedIndexes.size > 0) {
      const citations = [...rawCitedIndexes].map((index) => `[Source ${index + 1}]`).join(", ");
      finalAnswer = `${finalAnswer} ${citations}`;
    }

    let finalCitedIndexes = extractCitedSourceIndexes(finalAnswer, rankedDocs.length);
    if (finalAnswer && finalCitedIndexes.size === 0 && keywordScore(rankedDocs[0].pageContent, question) > 0) {
      finalCitedIndexes = new Set([0]);
      finalAnswer = `${finalAnswer} [Source 1]`;
    }

    if (!finalAnswer || finalCitedIndexes.size === 0) {
      return res.json(noAnswerPayload());
    }

    // /* Step 6: Media Detection from retrieved source documents only */
    // const mediaDocs = docsFromIndexes(finalCitedIndexes, rankedDocs);
    // const { images, videos, links } = limitMediaForClearResponse(
    //   collectMediaFromDocs(mediaDocs, mediaIntent, question),
    //   mediaIntent
    // );
    /* ==========================
   SMART MEDIA MATCHING
========================== */

    let mediaDocs = docsFromIndexes(
      finalCitedIndexes,
      rankedDocs
    );

    /* Extract names automatically from response */
    const detectedNames =
      extractEntityNames(finalAnswer);

    /* Match only relevant docs */
    if (detectedNames.length > 0) {

      mediaDocs = rankedDocs.filter(doc => {

        const content =
          doc.pageContent.toLowerCase();

        return detectedNames.some(name =>
          content.includes(name.toLowerCase())
        );

      });

    }

    /* fallback */
    if (!mediaDocs.length) {
      mediaDocs = rankedDocs;
    }

    const { images, videos, links } =
      limitMediaForClearResponse(
        collectMediaFromDocs(
          mediaDocs,
          mediaIntent
        ),
        mediaIntent
      );

    res.json({
      response: finalAnswer,
      images,
      videos,
      links
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    console.log("🟡 Initializing vector store...");

    await initVectorStore();

    console.log("🟢 Vector store initialized");

    const server = app.listen(PORT, () => {
      console.log(`🚀 RAG API running on port ${PORT}`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`⚠️ Port ${PORT} already in use. Server already running.`);
        return;
      }

      console.error("❌ Server error:", err);
    });

  } catch (error) {
    console.error("❌ Startup failed:", error);
  }
}

startServer();