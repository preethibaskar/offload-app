// Runs eval/dataset.json through the exact same prompt api/sort.js uses,
// and reports:
//   - overall accuracy
//   - per-category accuracy
//   - a confusion matrix (expected -> what it actually predicted)
//   - mismatches printed out for manual review
//   - optional consistency check: run the same item N times and see how
//     often the model agrees with itself (set CONSISTENCY_RUNS=3 to try it)
//
// Usage:
//   npm run eval
//   CONSISTENCY_RUNS=3 npm run eval
//
// This calls Anthropic directly (not your deployed /api/sort) so it can run
// standalone with just an API key — no need for a live Supabase session.

import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildSortPrompt, CATEGORIES, parseSortResponse } from "../shared/sortPrompt.js";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSISTENCY_RUNS = parseInt(process.env.CONSISTENCY_RUNS || "1", 10);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in your .env file.");
  process.exit(1);
}

async function callSort(text) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: buildSortPrompt(text) }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Anthropic request failed");
  }
  return parseSortResponse(data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dataset = JSON.parse(
    readFileSync(join(__dirname, "dataset.json"), "utf-8")
  );

  const confusion = {};
  CATEGORIES.forEach((expected) => {
    confusion[expected] = {};
    CATEGORIES.forEach((predicted) => (confusion[expected][predicted] = 0));
  });

  const perCategoryTotal = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const perCategoryCorrect = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const mismatches = [];
  const parseErrors = [];
  const consistencyIssues = [];

  let correct = 0;
  let total = 0;

  for (const { text, expected } of dataset) {
    let predictions;
    try {
      predictions = await Promise.all(
        Array.from({ length: CONSISTENCY_RUNS }, () => callSort(text))
      );
    } catch (err) {
      parseErrors.push({ text, error: err.message });
      continue;
    }

    const categories = predictions.map((p) => (Array.isArray(p) && p[0] ? p[0].category : null));
    if (categories.some((c) => c === null)) {
      parseErrors.push({ text, error: "Response did not contain a usable item" });
      continue;
    }

    if (CONSISTENCY_RUNS > 1) {
      const unique = new Set(categories);
      if (unique.size > 1) {
        consistencyIssues.push({ text, categories });
      }
    }

    const tally = {};
    categories.forEach((c) => (tally[c] = (tally[c] || 0) + 1));
    const predicted = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];

    total += 1;
    perCategoryTotal[expected] = (perCategoryTotal[expected] || 0) + 1;
    if (confusion[expected]) confusion[expected][predicted] = (confusion[expected][predicted] || 0) + 1;

    if (predicted === expected) {
      correct += 1;
      perCategoryCorrect[expected] = (perCategoryCorrect[expected] || 0) + 1;
    } else {
      mismatches.push({ text, expected, predicted });
    }

    await sleep(150);
  }

  console.log("\n=== Offload Sort Accuracy Report ===\n");
  console.log(`Overall accuracy: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)\n`);

  console.log("Per-category accuracy:");
  CATEGORIES.forEach((cat) => {
    const t = perCategoryTotal[cat] || 0;
    const c = perCategoryCorrect[cat] || 0;
    const pct = t > 0 ? ((c / t) * 100).toFixed(1) : "n/a";
    console.log(`  ${cat.padEnd(10)} ${c}/${t}  (${pct}%)`);
  });

  console.log("\nConfusion matrix (rows = expected, columns = predicted):");
  const header = "".padEnd(12) + CATEGORIES.map((c) => c.padEnd(11)).join("");
  console.log(header);
  CATEGORIES.forEach((expected) => {
    const row = CATEGORIES.map((predicted) => String(confusion[expected][predicted]).padEnd(11)).join("");
    console.log(expected.padEnd(12) + row);
  });

  if (mismatches.length) {
    console.log(`\nMismatches (${mismatches.length}):`);
    mismatches.forEach((m) => {
      console.log(`  "${m.text}"\n    expected: ${m.expected}  got: ${m.predicted}`);
    });
  }

  if (CONSISTENCY_RUNS > 1) {
    console.log(`\nConsistency check (${CONSISTENCY_RUNS} runs per item):`);
    if (consistencyIssues.length === 0) {
      console.log("  All items got the same category on every run.");
    } else {
      console.log(`  ${consistencyIssues.length} item(s) had disagreement across runs:`);
      consistencyIssues.forEach((c) => {
        console.log(`  "${c.text}" -> ${c.categories.join(", ")}`);
      });
    }
  }

  if (parseErrors.length) {
    console.log(`\nParse/response errors (${parseErrors.length}):`);
    parseErrors.forEach((e) => console.log(`  "${e.text}": ${e.error}`));
  }
}

main();
