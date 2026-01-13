// lawStorage.js
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite"); // wrapper for async open()

const DB_PATH = path.resolve("./newLaws.db");

let db = null;

async function initDB() {
    try {
        await fs.promises.access(DB_PATH, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        try {
            await fs.promises.mkdir(path.dirname(DB_PATH), { recursive: true });
        } catch (_) {}

        await fs.promises.writeFile(DB_PATH, Buffer.alloc(0));
    }

    db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    });

    await db.run("PRAGMA foreign_keys = ON");

    await db.exec(`
        CREATE TABLE IF NOT EXISTS Acts (
            act_id TEXT PRIMARY KEY,
            act_name TEXT,
            act_document_name TEXT,
            act_ministry TEXT,
            act_effective_date TEXT,
            act_short_description TEXT,
            act_long_description TEXT
        );

        CREATE TABLE IF NOT EXISTS Regulations (
            regulation_id TEXT PRIMARY KEY,
            regulation_name TEXT,
            regulation_document_name TEXT,
            regulation_ministry TEXT,
            regulation_effective_date TEXT,
            regulation_short_description TEXT,
            regulation_long_description TEXT
        );

        CREATE TABLE IF NOT EXISTS Chapters (
            chapter_id TEXT PRIMARY KEY,
            chapter_title TEXT,
            chapter_text TEXT,
            chapter_summary TEXT,

            act_id TEXT,
            regulation_id TEXT,

            FOREIGN KEY(act_id) REFERENCES Acts(act_id) ON DELETE CASCADE,
            FOREIGN KEY(regulation_id) REFERENCES Regulations(regulation_id) ON DELETE CASCADE,

            -- enforce exactly one owner
            CHECK (
                (act_id IS NOT NULL AND regulation_id IS NULL)
                OR
                (act_id IS NULL AND regulation_id IS NOT NULL)
            )
        );

        CREATE TABLE IF NOT EXISTS Sections (
            section_id TEXT PRIMARY KEY,
            section_title TEXT,
            section_text TEXT,
            section_summary TEXT,
            chapter_id TEXT NOT NULL,
            FOREIGN KEY(chapter_id) REFERENCES Chapters(chapter_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Clauses (
            clause_id TEXT PRIMARY KEY,
            clause_title TEXT,
            clause_text TEXT,
            clause_summary TEXT,
            chapter_id TEXT NOT NULL,
            FOREIGN KEY(chapter_id) REFERENCES Chapters(chapter_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ActRegulationMapping (
            regulation_id TEXT PRIMARY KEY,
            applicable_act_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(applicable_act_ids)),
            FOREIGN KEY(regulation_id) REFERENCES Regulations(regulation_id) ON DELETE CASCADE
        );
    `);
    console.log("✅ DB initialized");
}

// helper wrappers
async function ensureDB() {
    if (!db) await initDB();
    return db;
}

/* ===========================
   UPSERT HELPERS
   =========================== */

async function addOrUpdateAct({
    act_id,
    act_name = null,
    act_ministry = null,
    act_effective_date = null,
    act_document_name = null,
    act_short_description = null,
    act_long_description = null,
}) {
    const db = await ensureDB();

    await db.run(`
        INSERT INTO Acts (
            act_id, act_name, act_ministry, act_effective_date,
            act_document_name, act_short_description, act_long_description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(act_id) DO UPDATE SET
        act_name=excluded.act_name,
        act_ministry=excluded.act_ministry,
        act_effective_date=excluded.act_effective_date,
        act_document_name=excluded.act_document_name,
        act_short_description=excluded.act_short_description,
        act_long_description=excluded.act_long_description
    `,
        [
            act_id,
            act_name,
            act_ministry,
            act_effective_date,
            act_document_name,
            act_short_description,
            act_long_description,
        ]
    );

    return getAct(act_id);
}

async function addOrUpdateRegulation({
    regulation_id,
    regulation_name = null,
    regulation_document_name = null,
    regulation_ministry = null,
    regulation_effective_date = null,
    regulation_short_description = null,
    regulation_long_description = null,
}) {
    const db = await ensureDB();

    await db.run(`
        INSERT INTO Regulations (
            regulation_id, regulation_name, regulation_document_name,
            regulation_ministry, regulation_effective_date,
            regulation_short_description, regulation_long_description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(regulation_id) DO UPDATE SET
        regulation_name=excluded.regulation_name,
        regulation_document_name=excluded.regulation_document_name,
        regulation_ministry=excluded.regulation_ministry,
        regulation_effective_date=excluded.regulation_effective_date,
        regulation_short_description=excluded.regulation_short_description,
        regulation_long_description=excluded.regulation_long_description
    `,
        [
            regulation_id,
            regulation_name,
            regulation_document_name,
            regulation_ministry,
            regulation_effective_date,
            regulation_short_description,
            regulation_long_description,
        ]
    );

    await db.run(`
        INSERT INTO ActRegulationMapping (regulation_id, applicable_act_ids)
        VALUES (?, '[]')
        ON CONFLICT(regulation_id) DO NOTHING
    `,
        [regulation_id]
    );

    return getRegulation(regulation_id);
}

async function addOrUpdateChapterByAct({
    chapter_id,
    chapter_title = null,
    chapter_text = null,
    chapter_summary = null,
    act_id,
}) {
    const db = await ensureDB();

    if (!act_id) throw new Error("addOrUpdateChapterByAct requires act_id");

    await db.run(`
        INSERT INTO Chapters (
            chapter_id, chapter_title, chapter_text, chapter_summary,
            act_id, regulation_id
        )
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(chapter_id) DO UPDATE SET
        chapter_title=excluded.chapter_title,
        chapter_text=excluded.chapter_text,
        chapter_summary=excluded.chapter_summary,
        act_id=excluded.act_id,
        regulation_id=NULL
    `,
        [chapter_id, chapter_title, chapter_text, chapter_summary, act_id]
    );

    return getChapter(chapter_id);
}

async function addOrUpdateChapterByRegulation({
    chapter_id,
    chapter_title = null,
    chapter_text = null,
    chapter_summary = null,
    regulation_id,
}) {
    const db = await ensureDB();

    if (!regulation_id)
        throw new Error("addOrUpdateChapterByRegulation requires regulation_id");

    await db.run(`
        INSERT INTO Chapters (
            chapter_id, chapter_title, chapter_text, chapter_summary,
            act_id, regulation_id
        )
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(chapter_id) DO UPDATE SET
        chapter_title=excluded.chapter_title,
        chapter_text=excluded.chapter_text,
        chapter_summary=excluded.chapter_summary,
        act_id=NULL,
        regulation_id=excluded.regulation_id
    `,
        [chapter_id, chapter_title, chapter_text, chapter_summary, regulation_id]
    );

    return getChapter(chapter_id);
}

async function addOrUpdateSection({
    section_id,
    section_title = null,
    section_text = null,
    section_summary = null,
    chapter_id,
}) {
    const db = await ensureDB();
    if (!chapter_id) throw new Error("addOrUpdateSection requires chapter_id");

    await db.run(`
        INSERT INTO Sections (section_id, section_title, section_text, section_summary, chapter_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(section_id) DO UPDATE SET
        section_title=excluded.section_title,
        section_text=excluded.section_text,
        section_summary=excluded.section_summary,
        chapter_id=excluded.chapter_id
    `,
        [section_id, section_title, section_text, section_summary, chapter_id]
    );

    return getSection(section_id);
}

async function addOrUpdateClause({
    clause_id,
    clause_title = null,
    clause_text = null,
    clause_summary = null,
    chapter_id,
}) {
    const db = await ensureDB();
    if (!chapter_id) throw new Error("addOrUpdateClause requires chapter_id");

    await db.run(`
        INSERT INTO Clauses (clause_id, clause_title, clause_text, clause_summary, chapter_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(clause_id) DO UPDATE SET
        clause_title=excluded.clause_title,
        clause_text=excluded.clause_text,
        clause_summary=excluded.clause_summary,
        chapter_id=excluded.chapter_id
    `,
        [clause_id, clause_title, clause_text, clause_summary, chapter_id]
    );

    return getClause(clause_id);
}

async function addOrUpdateActRegulationMapping(regulation_id, applicable_act_ids = []) {
    const db = await ensureDB();
    const jsonActs = JSON.stringify(applicable_act_ids);

    await db.run(`
        INSERT INTO ActRegulationMapping (regulation_id, applicable_act_ids)
        VALUES (?, ?)
        ON CONFLICT(regulation_id) DO UPDATE SET
        applicable_act_ids = excluded.applicable_act_ids
    `,
        [regulation_id, jsonActs]
    );

    return getActRegulationMapping(regulation_id);
}

/* ===========================
   GET / FETCH HELPERS
   =========================== */

async function getAct(act_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Acts WHERE act_id = ?`, [act_id]);
}

async function getAllActs() {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Acts`);
}

async function getAllChapters() {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Chapters`);
}

async function getAllSections() {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Sections`);
}

async function getAllRegulations() {
    const db = await ensureDB();
    const regulations = await db.all(`SELECT * FROM Regulations ORDER BY regulation_id`);
    const mappings = await db.all(`SELECT * FROM ActRegulationMapping`);

    const map = new Map(mappings.map((m) => [m.regulation_id, m.applicable_act_ids]));

    return regulations.map((r) => ({
        ...r,
        applicable_act_ids: JSON.parse(map.get(r.regulation_id) || "[]"),
    }));
}

async function getChapter(chapter_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Chapters WHERE chapter_id = ?`, [chapter_id]);
}

async function getChaptersByAct(act_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Chapters WHERE act_id = ? ORDER BY chapter_id`, [act_id]);
}

async function getChaptersByRegulation(regulation_id) {
    const db = await ensureDB();
    return db.all(
        `SELECT * FROM Chapters WHERE regulation_id = ? ORDER BY chapter_id`,
        [regulation_id]
    );
}

async function getSection(section_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Sections WHERE section_id = ?`, [section_id]);
}

async function getSectionsByChapter(chapter_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Sections WHERE chapter_id = ? ORDER BY section_id`, [
        chapter_id,
    ]);
}

async function getClause(clause_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Clauses WHERE clause_id = ?`, [clause_id]);
}

async function getClausesByChapter(chapter_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Clauses WHERE chapter_id = ? ORDER BY clause_id`, [
        chapter_id,
    ]);
}

async function getRegulation(regulation_id) {
    const db = await ensureDB();
    const regulation = await db.get(`SELECT * FROM Regulations WHERE regulation_id = ?`, [
        regulation_id,
    ]);
    if (!regulation) return null;

    const mapping = await db.get(
        `SELECT applicable_act_ids FROM ActRegulationMapping WHERE regulation_id = ?`,
        [regulation_id]
    );

    regulation.applicable_act_ids = mapping?.applicable_act_ids
        ? JSON.parse(mapping.applicable_act_ids)
        : [];

    return regulation;
}

async function getRegulationsByAct(act_id) {
    const db = await ensureDB();
    return db.all(`
        SELECT r.*
        FROM Regulations r
        INNER JOIN ActRegulationMapping m
        ON r.regulation_id = m.regulation_id
        WHERE EXISTS (
            SELECT 1
            FROM json_each(m.applicable_act_ids)
            WHERE json_each.value = ?
        )
        ORDER BY r.regulation_id
    `,
        [act_id]
    );
}

async function getActRegulationMapping(regulation_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM ActRegulationMapping WHERE regulation_id = ?`, [
        regulation_id,
    ]);
}

/* ===========================
   DELETE HELPERS
   =========================== */
async function deleteAct(act_id) {
    const db = await ensureDB();
    await db.run(`
        UPDATE ActRegulationMapping
        SET applicable_act_ids =
        COALESCE(
            (SELECT json_group_array(value)
            FROM json_each(applicable_act_ids)
            WHERE value != ?),
            '[]'
        )
        WHERE EXISTS (
            SELECT 1
            FROM json_each(applicable_act_ids)
            WHERE value = ?
        )
    `,
        [act_id, act_id]
    );

    await db.run(`DELETE FROM ActRegulationMapping WHERE json_array_length(applicable_act_ids) = 0`);
    return db.run(`DELETE FROM Acts WHERE act_id = ?`, [act_id]);
}

async function deleteChapter(chapter_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Chapters WHERE chapter_id = ?`, [chapter_id]);
}

async function deleteSection(section_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Sections WHERE section_id = ?`, [section_id]);
}

async function deleteRegulation(regulation_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Regulations WHERE regulation_id = ?`, [regulation_id]);
}

async function deleteClause(clause_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Clauses WHERE clause_id = ?`, [clause_id]);
}

async function deleteActRegulationMapping(regulation_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM ActRegulationMapping WHERE regulation_id = ?`, [
        regulation_id,
    ]);
}

async function closeDB() {
    if (db) {
        await db.close();
        db = null;
    }
}

module.exports = {
    // initialization/management
    initDB,
    ensureDB,
    closeDB,

    // add or update
    addOrUpdateAct,
    addOrUpdateChapterByAct,
    addOrUpdateChapterByRegulation,
    addOrUpdateSection,
    addOrUpdateRegulation,
    addOrUpdateClause,
    addOrUpdateActRegulationMapping,

    // get / fetch
    getAllActs,
    getAllChapters,
    getAllSections,
    getAllRegulations,
    getChaptersByAct,
    getChaptersByRegulation,
    getSectionsByChapter,
    getClausesByChapter,
    getRegulationsByAct,

    // single-item fetches
    getAct,
    getChapter,
    getSection,
    getRegulation,
    getClause,
    getActRegulationMapping,

    // deletions
    deleteAct,
    deleteChapter,
    deleteSection,
    deleteRegulation,
    deleteClause,
    deleteActRegulationMapping,
};