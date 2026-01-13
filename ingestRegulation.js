// ingestRegulation.js
"use strict";

const fs = require("fs");
const path = require("path");
const lawsStorage = require(path.join(__dirname, "./lawsStorageSimple.js"));

// ─────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────
const inputDirPath = process.argv[2];
const flag = process.argv[3]; // optional
const isAll = flag === "--all";

if (!inputDirPath) {
    console.log("❌ Invalid arguments.");
    console.error("Usage: node ingestRegulation.js <Regulation Directory Path>");
    console.error("--- OR ---");
    console.error("Usage: node ingestRegulation.js <masterDirPath having all Regulations> --all");
    process.exit(1);
}
if(!process.env.DB_PATH) {
    console.error("❌ Environment variable DB_PATH is not set.");
    console.log("⚠️ Env file must be present the working directory with DB_PATH defined.");
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
    const regulationFile = path.join(dirPath, "regulation.json");
    const chaptersFile = path.join(dirPath, "chapters.json");
    const clausesFile = path.join(dirPath, "clauses.json");

    return (
        fs.existsSync(regulationFile) &&
        fs.existsSync(chaptersFile) &&
        fs.existsSync(clausesFile) &&
        fs.statSync(regulationFile).isFile() &&
        fs.statSync(chaptersFile).isFile() &&
        fs.statSync(clausesFile).isFile()
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
    const REGULATION_FILE = path.join(resolvedJsonDir, "regulation.json");
    const CHAPTERS_FILE = path.join(resolvedJsonDir, "chapters.json");
    const CLAUSES_FILE = path.join(resolvedJsonDir, "clauses.json");

    console.log(`📥 Loading JSON files from: ${resolvedJsonDir}`);

    const regulation = await loadJSON(REGULATION_FILE);
    const chapters = await loadJSON(CHAPTERS_FILE);
    let clauses = await loadJSON(CLAUSES_FILE);

    if (!regulation || !regulation.regulation_id) {
        throw new Error(`Invalid regulation.json in ${resolvedJsonDir}: missing regulation_id`);
    }

    if (!Array.isArray(chapters)) {
        throw new Error(`chapters.json must be an array in ${resolvedJsonDir}`);
    }

    // normalize clauses to array
    if (!Array.isArray(clauses)) {
        clauses = [clauses];
    }

    console.log("🧾 Ingesting Regulation...");
    await lawsStorage.addOrUpdateRegulation({
        regulation_id: regulation.regulation_id,
        regulation_name: regulation.regulation_name,
        regulation_ministry: regulation.regulation_ministry || null,
        regulation_effective_date: regulation.regulation_effective_date || null,
        regulation_document_name: regulation.regulation_document_name || null,
        regulation_short_description: regulation.short_description || null,
        regulation_long_description: regulation.long_description || null,
    });

    console.log(`📚 Ingesting ${chapters.length} chapter(s)...`);
    for (const chapter of chapters) {
        if (!chapter.chapter_id || !chapter.regulation_id) {
            throw new Error(
                `Invalid chapter record in ${resolvedJsonDir}: missing chapter_id or regulation_id`
            );
        }

        await lawsStorage.addOrUpdateChapterByRegulation({
            chapter_id: chapter.chapter_id,
            chapter_title: chapter.chapter_title,
            chapter_text: chapter.chapter_text,
            chapter_summary: chapter.chapter_summary || null,
            regulation_id: chapter.regulation_id,
        });
    }

    console.log(`📄 Ingesting ${clauses.length} clause(s)...`);
    for (const clause of clauses) {
        if (!clause.clause_id || !clause.chapter_id) {
            throw new Error(`Invalid clause record in ${resolvedJsonDir}: missing clause_id or chapter_id`);
        }

        await lawsStorage.addOrUpdateClause({
            clause_id: clause.clause_id,
            clause_title: clause.clause_title,
            clause_text: clause.clause_text,
            clause_summary: clause.clause_summary || null,
            chapter_id: clause.chapter_id,
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
                `Directory is missing required files (regulation.json, chapters.json, clauses.json): ${resolvedInputDir}`
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
            // continue with next directory
        }
    }

    console.log("\n✅ Finished processing all directories");
}

ingest().catch(err => {
    console.error("❌ Ingestion failed:", err.message);
    process.exit(1);
});
