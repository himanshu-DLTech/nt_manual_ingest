// ingestDoc.js
"use strict";

const fs = require("fs");
const path = require("path");
const lawsStorage = require("./lawsStorageSimple.js");

// ─────────────────────────────────────────────
// Read JSON directory from argv[2]
// ─────────────────────────────────────────────
const jsonDirPath = process.argv[2];

if (!jsonDirPath) {
    console.error("❌ Usage: node ingestDoc.js <jsonDirPath>");
    process.exit(1);
}

const resolvedJsonDir = path.resolve(jsonDirPath);

if (!fs.existsSync(resolvedJsonDir) || !fs.statSync(resolvedJsonDir).isDirectory()) {
    console.error(`❌ Invalid jsonDirPath: ${resolvedJsonDir}`);
    process.exit(1);
}

// filenames picked from provided directory
const ACT_FILE = path.join(resolvedJsonDir, "act.json");
const CHAPTERS_FILE = path.join(resolvedJsonDir, "chapters.json");
const SECTIONS_FILE = path.join(resolvedJsonDir, "sections.json");

async function loadJSON(filePath) {
    try {
        const raw = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`Failed to load JSON file: ${path.basename(filePath)} → ${err.message}`);
    }
}

async function ingest() {
    const db = await lawsStorage.ensureDB();

    console.log(`📥 Loading JSON files from: ${resolvedJsonDir}`);

    const act = await loadJSON(ACT_FILE);
    const chapters = await loadJSON(CHAPTERS_FILE);
    let sections = await loadJSON(SECTIONS_FILE);

    if (!act || !act.act_id) {
        throw new Error("Invalid act.json: missing act_id");
    }

    if (!Array.isArray(chapters)) {
        throw new Error("chapters.json must be an array");
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
        act_long_description: act.long_description || null
    });

    console.log(`📚 Ingesting ${chapters.length} chapter(s)...`);
    for (const chapter of chapters) {
        if (!chapter.chapter_id || !chapter.act_id) {
            throw new Error(`Invalid chapter record: missing chapter_id or act_id`);
        }

        await lawsStorage.addOrUpdateChapter({
            chapter_id: chapter.chapter_id,
            chapter_title: chapter.chapter_title,
            chapter_text: chapter.chapter_text,
            chapter_summary: chapter.chapter_summary || null,
            act_id: chapter.act_id
        });
    }

    console.log(`📄 Ingesting ${sections.length} section(s)...`);
    for (const section of sections) {
        if (!section.section_id || !section.chapter_id) {
            throw new Error(`Invalid section record: missing section_id or chapter_id`);
        }

        await lawsStorage.addOrUpdateSection({
            section_id: section.section_id,
            section_title: section.section_title,
            section_text: section.section_text,
            section_summary: section.section_summary || null,
            chapter_id: section.chapter_id
        });
    }

    console.log("✅ Ingestion completed successfully");
}

ingest().catch(err => {
    console.error("❌ Ingestion failed:", err.message);
    process.exit(1);
});
