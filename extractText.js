#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

// adjust if your OCR library filename is different
const { getContent } = require(path.join(__dirname, "./thaiOcrSimple.js"));

/* --------------------------------------------------
   OCR a single PDF → TXT (same directory)
   SKIPS if TXT already exists
-------------------------------------------------- */
async function processSinglePdf(pdfPath) {
    const fileName = path.basename(pdfPath);
    const dir = path.dirname(pdfPath);

    const outputTxtPath = path.join(
        dir,
        path.basename(fileName, path.extname(fileName)) + ".txt"
    );

    // ✅ EXPLICIT VERIFICATION — SKIP IF TXT EXISTS
    if (fs.existsSync(outputTxtPath)) {
        console.log(`Skipping OCR (TXT already exists): ${outputTxtPath}`);
        return;
    }

    console.log(`Starting OCR: ${pdfPath}`);

    const pdfReadStream = fs.createReadStream(pdfPath);
    const extractedTextBuffer = await getContent(pdfReadStream, fileName);

    if (!extractedTextBuffer || extractedTextBuffer.length === 0) {
        console.warn(`OCR returned empty content: ${pdfPath}`);
    }

    await fs.promises.writeFile(outputTxtPath, extractedTextBuffer);

    console.log(`Saved → ${outputTxtPath}`);
}

/* --------------------------------------------------
   OCR a directory containing subdirectories
   (each subdirectory has exactly ONE PDF)
-------------------------------------------------- */
async function processDirectory(dirPath) {
    const dirents = await fs.promises.readdir(dirPath, {
        withFileTypes: true
    });

    for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;

        const subdirPath = path.join(dirPath, dirent.name);
        const entries = await fs.promises.readdir(subdirPath);

        // Find the single PDF
        const pdfFile = entries.find(
            f => path.extname(f).toLowerCase() === ".pdf"
        );

        if (!pdfFile) {
            console.warn(`No PDF found in: ${subdirPath}`);
            continue;
        }

        const pdfPath = path.join(subdirPath, pdfFile);

        try {
            await processSinglePdf(pdfPath); // reuse logic
        } catch (err) {
            console.error(`Failed processing ${pdfPath}: ${err.message}`);
        }
    }

    console.log("✔ All subdirectories processed");
}

/* --------------------------------------------------
   MAIN (auto-detects file vs directory)
-------------------------------------------------- */
async function main() {
    const inputPath = process.argv[2];

    if (!inputPath) {
        console.error("❌ Invalid arguments.");
        console.error("Usage:");
        console.error("  node ocr-cli.js /path/to/file.pdf");
        console.error("  node ocr-cli.js /path/to/directory");
        process.exit(1);
    }

    const resolvedPath = path.resolve(inputPath);

    if (!fs.existsSync(resolvedPath)) {
        console.error(`Path not found: ${resolvedPath}`);
        process.exit(1);
    }

    const stat = await fs.promises.stat(resolvedPath);

    if (stat.isFile()) {
        // OLD MODE: single PDF
        if (path.extname(resolvedPath).toLowerCase() !== ".pdf") {
            console.error("Input file must be a PDF");
            process.exit(1);
        }
        await processSinglePdf(resolvedPath);

    } else if (stat.isDirectory()) {
        // NEW MODE: directory of subdirectories
        await processDirectory(resolvedPath);

    } else {
        console.error("Unsupported input type");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error:", err.message);
    process.exit(1);
});
