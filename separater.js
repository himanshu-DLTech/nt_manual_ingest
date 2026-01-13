#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
}

async function moveFile(src, dest) {
    try {
        await fs.promises.rename(src, dest);
    } catch (err) {
        // Cross-device fallback
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
        console.error(`Usage: node ${path.basename(__filename)} <directory-path>`);
        process.exit(1);
    }

    const resolvedDir = path.resolve(dirPath);

    try {
        const stat = await fs.promises.stat(resolvedDir);
        if (!stat.isDirectory()) {
            throw new Error("Provided path is not a directory");
        }

        const files = await fs.promises.readdir(resolvedDir);

        if (!files.length) {
            console.log("Directory is empty");
            return;
        }

        const amendmentsDir = path.join(resolvedDir, "Amendments");
        const regulationsDir = path.join(resolvedDir, "Regulations");
        const actsDir = path.join(resolvedDir, "Acts");

        for (const file of files) {
            const fullPath = path.join(resolvedDir, file);

            const fileStat = await fs.promises.stat(fullPath);
            if (!fileStat.isFile()) continue;

            if (path.extname(file).toLowerCase() !== ".pdf") continue;

            const lowerName = file.toLowerCase();

            let targetDir;
            if (lowerName.includes("amendment")) {
                targetDir = amendmentsDir;
            } else if (lowerName.includes("regulation")) {
                targetDir = regulationsDir;
            } else {
                targetDir = actsDir;
            }

            await ensureDir(targetDir);

            const targetPath = path.join(targetDir, file);

            console.log(`Moving: ${file} → ${path.basename(targetDir)}/`);
            await moveFile(fullPath, targetPath);
        }

        console.log("✔ File organization complete");

    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
