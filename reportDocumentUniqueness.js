#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Safely hash a file using streaming (no full file in memory)
 */
function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("error", reject);
        stream.on("data", chunk => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

function isPdf(filename) {
    return filename.toLowerCase().endsWith(".pdf");
}

/**
 * Recursively walk directories
 */
async function walkDir(rootDir, onFile) {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            await walkDir(fullPath, onFile);
        } else if (entry.isFile()) {
            await onFile(fullPath);
        }
    }
}

async function main() {
    const inputDirs = process.argv.slice(2).map(d => path.resolve(d));

    if (inputDirs.length !== 5) {
        console.error("❌ Invalid arguments.");
        console.error(`Usage: node ${path.basename(__filename)} <dir1> <dir2> <dir3> <dir4> <dir5>`);
        process.exit(1);
    }

    let totalFiles = 0;

    // hash -> [paths]
    const hashToPaths = new Map();

    // rootDir -> count
    const dirCounts = new Map();

    // rootDir -> category -> count
    const dirCategoryCounts = new Map();

    for (const rootDir of inputDirs) {
        dirCounts.set(rootDir, 0);
        dirCategoryCounts.set(rootDir, new Map());

        await walkDir(rootDir, async filePath => {
            if (!isPdf(filePath)) return;

            let fileHash;
            try {
                fileHash = await hashFile(filePath);
            } catch (err) {
                console.error(`[ERROR] Could not read ${filePath}: ${err.message}`);
                return;
            }

            totalFiles++;

            // hash map
            if (!hashToPaths.has(fileHash)) {
                hashToPaths.set(fileHash, []);
            }
            hashToPaths.get(fileHash).push(filePath);

            // directory count
            dirCounts.set(rootDir, dirCounts.get(rootDir) + 1);

            // extract category: Directory > Category > DocumentDir > file.pdf
            const rel = path.relative(rootDir, filePath);
            const parts = rel.split(path.sep);

            if (parts.length >= 2) {
                const category = parts[0];
                const catMap = dirCategoryCounts.get(rootDir);
                catMap.set(category, (catMap.get(category) || 0) + 1);
            }
        });
    }

    const uniqueFiles = hashToPaths.size;
    const duplicateGroups = [...hashToPaths.entries()].filter(
        ([_, paths]) => paths.length > 1
    );

    // ================= REPORT =================
    console.log("\n========== PDF UNIQUENESS REPORT ==========\n");

    console.log(`Input directories scanned: ${inputDirs.length}`);
    console.log(`Total PDFs found: ${totalFiles}`);
    console.log(`Unique PDFs (by content): ${uniqueFiles}`);
    console.log(`Duplicate PDFs: ${totalFiles - uniqueFiles}`);

    console.log("\n--- Per Directory Totals ---");
    for (const dir of inputDirs) {
        console.log(`${dir}: ${dirCounts.get(dir)}`);
    }

    console.log("\n--- Per Directory / Category Totals ---");
    for (const [dir, catMap] of dirCategoryCounts.entries()) {
        for (const [cat, count] of catMap.entries()) {
            console.log(`${dir} > ${cat}: ${count}`);
        }
    }

    console.log("\n--- Duplicate PDF Groups (same content) ---");
    if (duplicateGroups.length === 0) {
        console.log("No duplicate PDFs found.");
    } else {
        duplicateGroups.forEach(([hash, paths], idx) => {
            console.log(`\nDuplicate Group ${idx + 1}`);
            console.log(`Content Hash: ${hash}`);
            paths.forEach(p => console.log(`  ${p}`));
        });
    }

    console.log("\n========== END OF REPORT ==========\n");
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
