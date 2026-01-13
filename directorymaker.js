#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

async function ensureDir(dirPath) {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

async function moveFile(src, dest) {
    try {
        await fs.promises.rename(src, dest);
    } catch (err) {
        // Handle cross-device moves
        if (err.code === "EXDEV") {
            await fs.promises.copyFile(src, dest);
            await fs.promises.unlink(src);
        } else {
            throw err;
        }
    }
}

async function main() {
    const dirPath = process.argv[2];

    if (!dirPath) {
        console.error("❌ Invalid arguments.");
        console.error("Usage: node move-pdfs-by-basename.js <directory-path>");
        process.exit(1);
    }

    const resolvedDir = path.resolve(dirPath);

    try {
        const stat = await fs.promises.stat(resolvedDir);
        if (!stat.isDirectory()) {
            throw new Error("Provided path is not a directory");
        }

        const entries = await fs.promises.readdir(resolvedDir);

        for (const entry of entries) {
            const fullPath = path.join(resolvedDir, entry);
            const entryStat = await fs.promises.stat(fullPath);

            if (!entryStat.isFile()) continue;
            if (path.extname(entry).toLowerCase() !== ".pdf") continue;

            const baseName = path.basename(entry, path.extname(entry))
            const targetDir = path.join(resolvedDir, baseName);
            const targetPath = path.join(targetDir, entry);

            await ensureDir(targetDir);

            console.log(`Moving ${entry} → ${baseName}/`);
            await moveFile(fullPath, targetPath);
        }

        console.log("✔ PDF organization complete");
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
