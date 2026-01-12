// lawStorage.js
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite"); // used only to ensure sensible async open; sqlite3 used for DB driver

const DB_PATH = path.resolve("./laws.db");

let db = null;

// ensure DB file exists (create if missing) and initialize tables
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
        mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    });

    await db.run("PRAGMA foreign_keys = ON");

    await db.exec(`
        CREATE TABLE IF NOT EXISTS Acts (
            act_id TEXT PRIMARY KEY,
            act_name TEXT,
            act_ministry TEXT,
            act_effective_date TEXT,
            act_document_name TEXT,
            act_short_description TEXT,
            act_long_description TEXT
        );

        CREATE TABLE IF NOT EXISTS Chapters (
            chapter_id TEXT PRIMARY KEY,
            chapter_title TEXT,
            chapter_text TEXT,
            chapter_summary TEXT,
            act_id TEXT,
            FOREIGN KEY(act_id) REFERENCES Acts(act_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Sections (
            section_id TEXT PRIMARY KEY,
            section_title TEXT,
            section_text TEXT,
            section_summary TEXT,
            chapter_id TEXT,
            FOREIGN KEY(chapter_id) REFERENCES Chapters(chapter_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Articles (
            article_id TEXT PRIMARY KEY,
            article_title TEXT,
            article_text TEXT,
            article_summary TEXT,
            section_id TEXT,
            FOREIGN KEY(section_id) REFERENCES Sections(section_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Regulations (
            regulation_id TEXT PRIMARY KEY,
            regulation_title TEXT,
            regulation_type TEXT,
            regulation_issuing_authority TEXT,
            regulation_effective_date TEXT,
            regulation_short_description TEXT,
            regulation_long_description TEXT
        );

        CREATE TABLE IF NOT EXISTS Clauses (
            clause_id TEXT PRIMARY KEY,
            clause_title TEXT,
            clause_text TEXT,
            clause_summary TEXT,
            regulation_id TEXT,
            FOREIGN KEY(regulation_id) REFERENCES Regulations(regulation_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS SubClauses (
            subclause_id TEXT PRIMARY KEY,
            subclause_title TEXT,
            subclause_text TEXT,
            subclause_summary TEXT,
            clause_id TEXT,
            FOREIGN KEY(clause_id) REFERENCES Clauses(clause_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Paragraphs (
            paragraph_id TEXT PRIMARY KEY,
            paragraph_text TEXT,
            paragraph_summary TEXT,
            article_id TEXT,
            clause_id TEXT,
            FOREIGN KEY(article_id) REFERENCES Articles(article_id) ON DELETE CASCADE,
            FOREIGN KEY(clause_id) REFERENCES Clauses(clause_id) ON DELETE CASCADE,
            CHECK((article_id IS NOT NULL) <> (clause_id IS NOT NULL))
        );

        CREATE TABLE IF NOT EXISTS ActRegulationMapping (
            regulation_id TEXT PRIMARY KEY,
            applicable_act_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(applicable_act_ids)),
            FOREIGN KEY(regulation_id) REFERENCES Regulations(regulation_id) ON DELETE CASCADE
        );
    `);

    console.log("✅ DB initialized (no global indexing)");
}

// helper wrappers
async function ensureDB() {
    if (!db) await initDB();
    return db;
}


/*
 * Upsert helpers
 * Each addOrUpdate function accepts a single object containing the relevant fields.
 * For "id" fields we use the names as per schema comment:
 * - Acts: act_id
 * - Chapters: chapter_id
 * - Sections: section_id
 * - Articles: article_id
 * - Paragraphs: paragraph_id
 * - Regulations: regulation_id
 * - Clauses: clause_id
 * - SubClauses: subclause_id
 *
 * All functions return the inserted/updated row (by fetching it back) or throw on error.
 */

async function addOrUpdateAct({
    act_id, act_name = null, act_ministry = null, act_effective_date = null,
    act_document_name = null, act_short_description = null, act_long_description = null
}) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Acts (act_id, act_name, act_ministry, act_effective_date, act_document_name, act_short_description, act_long_description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(act_id) DO UPDATE SET
            act_name=excluded.act_name,
            act_ministry=excluded.act_ministry,
            act_effective_date=excluded.act_effective_date,
            act_document_name=excluded.act_document_name,
            act_short_description=excluded.act_short_description,
            act_long_description=excluded.act_long_description
    `, [act_id, act_name, act_ministry, act_effective_date, act_document_name, act_short_description, act_long_description]);

    return getAct(act_id);
}

async function addOrUpdateChapter({ chapter_id, chapter_title = null, chapter_text = null, chapter_summary = null, act_id = null }) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Chapters (chapter_id, chapter_title, chapter_text, chapter_summary, act_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chapter_id) DO UPDATE SET
            chapter_title=excluded.chapter_title,
            chapter_text=excluded.chapter_text,
            chapter_summary=excluded.chapter_summary,
            act_id=excluded.act_id
    `, [chapter_id, chapter_title, chapter_text, chapter_summary, act_id]);

    return getChapter(chapter_id);
}

async function addOrUpdateSection({ section_id, section_title = null, section_text = null, section_summary = null, chapter_id = null }) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Sections (section_id, section_title, section_text, section_summary, chapter_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(section_id) DO UPDATE SET
            section_title=excluded.section_title,
            section_text=excluded.section_text,
            section_summary=excluded.section_summary,
            chapter_id=excluded.chapter_id
    `, [section_id, section_title, section_text, section_summary, chapter_id]);

    return getSection(section_id);
}

async function addOrUpdateArticle({ article_id, article_title = null, article_text = null, article_summary = null, section_id = null }) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Articles (article_id, article_title, article_text, article_summary, section_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(article_id) DO UPDATE SET
            article_title=excluded.article_title,
            article_text=excluded.article_text,
            article_summary=excluded.article_summary,
            section_id=excluded.section_id
    `, [article_id, article_title, article_text, article_summary, section_id]);

    return getArticle(article_id);
}

async function addOrUpdateParagraph({ paragraph_id, paragraph_text = null,paragraph_summary = null, article_id = null, clause_id = null}) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Paragraphs (paragraph_id, paragraph_text,paragraph_summary, article_id, clause_id)
        VALUES (?, ?, ?, ?,?)
        ON CONFLICT(paragraph_id) DO UPDATE SET
            paragraph_text = excluded.paragraph_text,
            paragraph_summary = excluded.paragraph_summary,
            article_id = excluded.article_id,
            clause_id = excluded.clause_id
    `, [paragraph_id, paragraph_text, paragraph_summary, article_id ?? null, clause_id ?? null]);

    return getParagraph(paragraph_id);
}

async function addOrUpdateRegulation({
    regulation_id, regulation_title = null, regulation_type = null, regulation_issuing_authority = null,
    regulation_effective_date = null, regulation_short_description = null, regulation_long_description = null
}) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Regulations (regulation_id, regulation_title, regulation_type, regulation_issuing_authority, regulation_effective_date, regulation_short_description, regulation_long_description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(regulation_id) DO UPDATE SET
            regulation_title=excluded.regulation_title,
            regulation_type=excluded.regulation_type,
            regulation_issuing_authority=excluded.regulation_issuing_authority,
            regulation_effective_date=excluded.regulation_effective_date,
            regulation_short_description=excluded.regulation_short_description,
            regulation_long_description=excluded.regulation_long_description
    `, [regulation_id, regulation_title, regulation_type, regulation_issuing_authority, regulation_effective_date, regulation_short_description, regulation_long_description]);

    return getRegulation(regulation_id);
}

async function addOrUpdateClause({ clause_id, clause_title = null, clause_text = null,clause_summary = null, regulation_id = null }) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO Clauses (clause_id, clause_title, clause_text,clause_summary, regulation_id)
        VALUES (?, ?, ?,?, ?)
        ON CONFLICT(clause_id) DO UPDATE SET
            clause_title=excluded.clause_title,
            clause_text=excluded.clause_text,
            clause_summary=excluded.clause_summary,
            regulation_id=excluded.regulation_id
    `, [clause_id, clause_title, clause_text,clause_summary, regulation_id]);

    return getClause(clause_id);
}

async function addOrUpdateSubClause({ subclause_id, subclause_title = null, subclause_text = null,subclause_summary=null, clause_id = null }) {
    const db = await ensureDB();
    await db.run(`
        INSERT INTO SubClauses (subclause_id, subclause_title, subclause_text,subclause_summary, clause_id)
        VALUES (?, ?, ?, ?,?)
        ON CONFLICT(subclause_id) DO UPDATE SET
            subclause_title=excluded.subclause_title,
            subclause_text=excluded.subclause_text,
            subclause_summary=excluded.subclause_summary,
            clause_id=excluded.clause_id
    `, [subclause_id, subclause_title, subclause_text,subclause_summary, clause_id]);

    return getSubClause(subclause_id);
}

async function addOrUpdateActRegulationMapping(regulation_id, applicable_act_ids = []) {
    const db = await ensureDB();
    const jsonActs = JSON.stringify(applicable_act_ids);
    await db.run(`
        INSERT INTO ActRegulationMapping (regulation_id, applicable_act_ids)
        VALUES (?, ?)
        ON CONFLICT(regulation_id) DO UPDATE SET
            applicable_act_ids = excluded.applicable_act_ids
    `, [regulation_id, jsonActs]);
    return getActRegulationMapping(regulation_id);
}

/*
 * Get / fetch helpers
 */

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
    const rows = await db.all(`SELECT * FROM Regulations`);
    return rows.map(regulation => ({ ...regulation, applicable_act_ids: JSON.parse(regulation.applicable_act_ids || "[]") }));
}

async function getChapter(chapter_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Chapters WHERE chapter_id = ?`, [chapter_id]);
}

async function getChaptersByAct(act_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Chapters WHERE act_id = ? ORDER BY chapter_id`, [act_id]);
}

async function getSection(section_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Sections WHERE section_id = ?`, [section_id]);
}

async function getSectionsByChapter(chapter_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Sections WHERE chapter_id = ? ORDER BY section_id`, [chapter_id]);
}

async function getArticle(article_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Articles WHERE article_id = ?`, [article_id]);
}

async function getArticlesBySection(section_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Articles WHERE section_id = ? ORDER BY article_id`, [section_id]);
}

async function getParagraph(paragraph_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Paragraphs WHERE paragraph_id = ?`, [paragraph_id]);
}

async function getParagraphsByArticle(article_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Paragraphs WHERE article_id = ? ORDER BY paragraph_id`, [article_id]);
}

async function getParagraphsByClause(clause_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Paragraphs WHERE clause_id = ? ORDER BY paragraph_id`, [clause_id]);
}

async function getRegulation(regulation_id) {
    const db = await ensureDB();
    const regulation = await db.get(`SELECT * FROM Regulations WHERE regulation_id = ?`, [regulation_id]);
    if (!regulation) return null;
    const mapping = await db.get(`SELECT applicable_act_ids FROM ActRegulationMapping WHERE regulation_id = ?`, [regulation_id]);
    regulation.applicable_act_ids = mapping?.applicable_act_ids ? JSON.parse(mapping.applicable_act_ids) : [];
    return regulation;
}

async function getRegulationsByAct(act_id) {
    const db = await ensureDB();
    return db.all(`
        SELECT r.*
        FROM Regulations r
        INNER JOIN ActRegulationMapping m
            ON r.regulation_id = m.regulation_id
        INNER JOIN json_each(m.applicable_act_ids) j
            ON j.value = json(?)
        ORDER BY r.regulation_id
    `, [act_id]);
}

async function getClause(clause_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM Clauses WHERE clause_id = ?`, [clause_id]);
}

async function getClausesByRegulation(regulation_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM Clauses WHERE regulation_id = ? ORDER BY clause_id`, [regulation_id]);
}

async function getSubClause(subclause_id) {
    const db = await ensureDB();
    return db.get(`SELECT * FROM SubClauses WHERE subclause_id = ?`, [subclause_id]);
}

async function getSubClausesByClause(clause_id) {
    const db = await ensureDB();
    return db.all(`SELECT * FROM SubClauses WHERE clause_id = ? ORDER BY subclause_id`, [clause_id]);
}

async function getActRegulationMapping(regulation_id) {
    const db = await ensureDB();
    return db.get(
        `SELECT * FROM ActRegulationMapping WHERE regulation_id = ?`,
        [regulation_id]
    );
}

/*
 * Delete helpers (convenience)
 */
async function deleteAct(act_id) {
    const db = await ensureDB();
    await db.run(`
        UPDATE ActRegulationMapping
        SET applicable_act_ids =
            (SELECT json_group_array(value)
            FROM json_each(applicable_act_ids)
            WHERE value != json(?))
        WHERE EXISTS (
            SELECT 1
            FROM json_each(applicable_act_ids)
            WHERE value = json(?)
        )
    `, [act_id, act_id]);
    await db.run(`DELETE FROM ActRegulationMapping WHERE json_array_length(applicable_act_ids) = 0;`);
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

async function deleteArticle(article_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Articles WHERE article_id = ?`, [article_id]);
}

async function deleteParagraph(paragraph_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Paragraphs WHERE paragraph_id = ?`, [paragraph_id]);
}

async function deleteRegulation(regulation_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Regulations WHERE regulation_id = ?`, [regulation_id]);
}

async function deleteClause(clause_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM Clauses WHERE clause_id = ?`, [clause_id]);
}

async function deleteSubClause(subclause_id) {
    const db = await ensureDB();
    return db.run(`DELETE FROM SubClauses WHERE subclause_id = ?`, [subclause_id]);
}

async function closeDB() {
    if (db) {
        await db.close();
        db = null;
    }
}

/* ===========================
   ALL CRUD FUNCTIONS BELOW
   ⬇️ UNCHANGED
   =========================== */

/* --- snipped for brevity ---
   EVERYTHING BELOW THIS POINT
   IS IDENTICAL TO YOUR ORIGINAL
   (no logic or export changes)
*/

module.exports = {
    // initialization/management
    initDB,
    ensureDB,
    closeDB,

    // add or update
    addOrUpdateAct,
    addOrUpdateChapter,
    addOrUpdateSection,
    addOrUpdateArticle,
    addOrUpdateParagraph,
    addOrUpdateRegulation,
    addOrUpdateClause,
    addOrUpdateSubClause,
    addOrUpdateActRegulationMapping,

    // get / fetch
    getAct,
    getAllActs,
    getAllChapters,
    getAllSections,
    getAllRegulations,
    getChaptersByAct,
    getSectionsByChapter,
    getArticlesBySection,
    getParagraphsByArticle,
    getParagraphsByClause,
    getRegulationsByAct,
    getClausesByRegulation,
    getSubClausesByClause,
    getActRegulationMapping,

    // single-item fetches
    getChapter,
    getSection,
    getArticle,
    getParagraph,
    getRegulation,
    getClause,
    getSubClause,

    // deletions
    deleteAct,
    deleteChapter,
    deleteSection,
    deleteArticle,
    deleteParagraph,
    deleteRegulation,
    deleteClause,
    deleteSubClause
};