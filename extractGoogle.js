import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";

dotenv.config();

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.log("❌ Please provide a question");
  process.exit(1);
}

console.log(`\n💬 Question: ${question}\n`);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "models/gemini-embedding-2",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "gemini-2.5-flash", // ✅ better free tier limits
  temperature: 0,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ✅ Retry with backoff — reads the retry delay from the error message itself
async function invokeWithRetry(llm, prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await llm.invoke(prompt);
    } catch (err) {
      const retryMatch = err.message.match(/retry in (\d+(\.\d+)?)s/i);
      const waitMs = retryMatch
        ? Math.ceil(parseFloat(retryMatch[1])) * 1000
        : 60000;

      if (attempt === retries) throw err;

      console.log(
        `   ⚠️  Rate limited. Retrying in ${waitMs / 1000}s... (attempt ${attempt}/${retries})`,
      );
      await sleep(waitMs);
    }
  }
}

async function search(question) {
  try {
    console.log("🔎 Searching Pinecone...\n");

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
    });

    // Retrieve more chunks from Pinecone
    const results = await vectorStore.similaritySearch(question, 10);

    // Rerank chunks using Gemini
    const rankingPrompt = `
    You are ranking document chunks by relevance.

    Question:
    ${question}

    Chunks:
    ${results.map((r, i) => `[${i}] ${r.pageContent}`).join("\n\n")}

    Return ONLY the 3 most relevant chunk numbers separated by commas.
    Example: 0,2,5
    `;

    const rankingResponse = await llm.invoke(rankingPrompt);

    const rankedIndexes = rankingResponse.content
    .match(/\d+/g)
    ?.map(Number)
    ?.slice(0, 3) || [0, 1, 2];

    const topResults = rankedIndexes.map(i => results[i]);

    if (!results.length) {
      console.log("❌ No results found.");
      return;
    }

    // Build context with numbered source tags
    const context = topResults
    .map(
        (doc, i) =>
        `[Source ${i + 1}: ${doc.metadata?.filename || "Unknown"}]\n${doc.pageContent}`,
    )
    .join("\n\n");

    // Build citation reference list
    const citationMap = topResults.map((doc, i) => ({
      id: i + 1,
      filename: doc.metadata?.filename || "Unknown",
      chunk: doc.metadata?.chunk ?? "?",
      excerpt: doc.pageContent.substring(0, 120).replace(/\n/g, " ") + "...",
    }));

    const prompt = `You are a helpful assistant. Use ONLY the context below to answer the question.
When you use information from a source, cite it inline using the format [Source N] where N is the source number.
If the answer is not found in the context, say "I don't have enough information to answer that."

Context:
${context}

Question: ${question}

Answer (with inline [Source N] citations):`;

    console.log("🤖 Generating consolidated answer...\n");

    const response = await invokeWithRetry(llm, prompt);

    // Print the answer
    console.log("✅ Answer:");
    console.log("------------------------------------");
    console.log(response.content);

    // Print the citation reference list
    console.log("\n📚 Citations:");
    console.log("------------------------------------");
    citationMap.forEach((c) => {
      console.log(`[Source ${c.id}] ${c.filename} (chunk ${c.chunk})`);
      console.log(`  └─ "...${c.excerpt}"`);
    });
  } catch (error) {
    if (error.message.includes("Quota exceeded")) {
      console.error(
        "❌ Daily quota exceeded. Please wait until tomorrow or upgrade your Google AI Studio plan at https://ai.google.dev",
      );
    } else {
      console.error("❌ Search error:", error.message);
    }
  }
}

search(question);