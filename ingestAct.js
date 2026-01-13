// ingestAct.js
"use strict";

const fs = require("fs");
const path = require("path");
const lawsStorage = require("./lawsStorageSimple.js");

// ─────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────
const inputDirPath = process.argv[2];
const flag = process.argv[3]; // optional
const isAll = flag === "--all";

if (!inputDirPath) {
  console.error("❌ Usage: node ingestAct.js <jsonDirPath> [--all]");
  process.exit(1);
}

const resolvedInputDir = path.resolve(inputDirPath);

if (!fs.existsSync(resolvedInputDir) || !fs.statSync(resolvedInputDir).isDirectory()) {
  console.error(`❌ Invalid inputDirPath: ${resolvedInputDir}`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function loadJSON(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load JSON file: ${path.basename(filePath)} → ${err.message}`);
  }
}

function isJsonDirectory(dirPath) {
  const actFile = path.join(dirPath, "act.json");
  const chaptersFile = path.join(dirPath, "chapters.json");
  const sectionsFile = path.join(dirPath, "sections.json");

  return (
    fs.existsSync(actFile) &&
    fs.existsSync(chaptersFile) &&
    fs.existsSync(sectionsFile) &&
    fs.statSync(actFile).isFile() &&
    fs.statSync(chaptersFile).isFile() &&
    fs.statSync(sectionsFile).isFile()
  );
}

function getSubDirectories(masterDir) {
  return fs
    .readdirSync(masterDir)
    .map(name => path.join(masterDir, name))
    .filter(p => fs.statSync(p).isDirectory());
}

// ─────────────────────────────────────────────
// Main ingestion logic for ONE jsonDirectory
// ─────────────────────────────────────────────
async function ingestOneJsonDirectory(resolvedJsonDir) {
  // filenames picked from provided directory
  const ACT_FILE = path.join(resolvedJsonDir, "act.json");
  const CHAPTERS_FILE = path.join(resolvedJsonDir, "chapters.json");
  const SECTIONS_FILE = path.join(resolvedJsonDir, "sections.json");

  console.log(`📥 Loading JSON files from: ${resolvedJsonDir}`);

  const act = await loadJSON(ACT_FILE);
  const chapters = await loadJSON(CHAPTERS_FILE);
  let sections = await loadJSON(SECTIONS_FILE);

  if (!act || !act.act_id) {
    throw new Error(`Invalid act.json in ${resolvedJsonDir}: missing act_id`);
  }

  if (!Array.isArray(chapters)) {
    throw new Error(`chapters.json must be an array in ${resolvedJsonDir}`);
  }

  // normalize sections to array
  if (!Array.isArray(sections)) {
    sections = [sections];
  }

  console.log("🧾 Ingesting Act...");
  await lawsStorage.addOrUpdateAct({
    act_id: act.act_id,
    act_name: act.act_name,
    act_ministry: act.act_ministry || null,
    act_effective_date: act.act_effective_date || null,
    act_document_name: act.act_document_name || null,
    act_short_description: act.short_description || null,
    act_long_description: act.long_description || null,
  });

  console.log(`📚 Ingesting ${chapters.length} chapter(s)...`);
  for (const chapter of chapters) {
    if (!chapter.chapter_id || !chapter.act_id) {
      throw new Error(`Invalid chapter record in ${resolvedJsonDir}: missing chapter_id or act_id`);
    }

    await lawsStorage.addOrUpdateChapterByAct({
      chapter_id: chapter.chapter_id,
      chapter_title: chapter.chapter_title,
      chapter_text: chapter.chapter_text,
      chapter_summary: chapter.chapter_summary || null,
      act_id: chapter.act_id,
    });
  }

  console.log(`📄 Ingesting ${sections.length} section(s)...`);
  for (const section of sections) {
    if (!section.section_id || !section.chapter_id) {
      throw new Error(`Invalid section record in ${resolvedJsonDir}: missing section_id or chapter_id`);
    }

    await lawsStorage.addOrUpdateSection({
      section_id: section.section_id,
      section_title: section.section_title,
      section_text: section.section_text,
      section_summary: section.section_summary || null,
      chapter_id: section.chapter_id,
    });
  }

  console.log("✅ Ingestion completed successfully");
}

// ─────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────
async function ingest() {
  await lawsStorage.ensureDB();

  if (!isAll) {
    // old behavior (single directory)
    if (!isJsonDirectory(resolvedInputDir)) {
      throw new Error(
        `Directory is missing required files (act.json, chapters.json, sections.json): ${resolvedInputDir}`
      );
    }
    await ingestOneJsonDirectory(resolvedInputDir);
    return;
  }

  // --all behavior (master dir containing multiple jsonDirectories)
  console.log(`📂 --all mode enabled. Master directory: ${resolvedInputDir}`);

  const subDirs = getSubDirectories(resolvedInputDir);
  const jsonDirs = subDirs.filter(isJsonDirectory);

  if (jsonDirs.length === 0) {
    throw new Error(`No valid jsonDirectories found inside master directory: ${resolvedInputDir}`);
  }

  console.log(`🗂️ Found ${jsonDirs.length} jsonDirectory(s) to ingest`);

  for (const dir of jsonDirs) {
    console.log("\n==================================================");
    console.log(`🚀 Ingesting: ${dir}`);
    console.log("==================================================");
    try {
      await ingestOneJsonDirectory(dir);
    } catch (err) {
      console.error(`❌ Failed ingestion for ${dir}: ${err.message}`);
      // continue processing other directories
    }
  }

  console.log("\n✅ Finished processing all directories");
}

ingest().catch(err => {
  console.error("❌ Ingestion failed:", err.message);
  process.exit(1);
});
