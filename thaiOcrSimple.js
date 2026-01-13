// Thai Document AI OCR - Full Quality Preprocessing
// by TekMonks Ltd - https://tekmonks.com
"use strict";

const os = require("os");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai");
const sharp = require("sharp");

/* ======================================================
   Configuration
   ====================================================== */
const confPath = path.join(__dirname, "conf", "thaiocr.json");
const conf = require(confPath);

const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || confPath;
const PROCESSOR = process.env.DOC_AI_PROCESSOR || conf.processor;
const DPI = Number(process.env.DPI || conf.dpi);
const SHARP = process.env.SHARP || conf.sharp;
const MEDIAN = Number(process.env.MEDIAN || conf.median);
const UNGAMMA = process.env.UNGAMMA || conf.ungamma;
const TARGET_WIDTH = Number(process.env.TARGET_WIDTH || conf.target_width);

const CONCURRENCY_IMAGE_ENHANCEMENT =
    Number(process.env.CONCURRENCY_IMAGE_ENHANCEMENT || conf.concurrency_image_enhancement);
const CONCURRENCY_GOOGLE_OCR =
    Number(process.env.CONCURRENCY_GOOGLE_OCR || conf.concurrency_google_ocr);
const CONCURRENCY_PDF_CONVERSION =
    Number(process.env.CONCURRENCY_PDF_CONVERSION || conf.concurrency_pdf_conversion);

/* ======================================================
   Simple Logger (preserves semantics)
   ====================================================== */
const LOG = {
    info: (...a) => console.log(...a),
    error: (...a) => console.error(...a)
};

/* ======================================================
   FS Helpers
   ====================================================== */
const mexists = async p => { try { await fsp.access(p); return true; } catch { return false; } };
const mread = p => fsp.readFile(p);
const mwrite = (p, d) => fsp.writeFile(p, d);
const mstat = p => fsp.stat(p);
const mdir = p => fsp.readdir(p);
const mrm = (p, o) => fsp.rm(p, o);
const maccess = (p, m) => fsp.access(p, m);
const mmkdir = (p, o) => fsp.mkdir(p, o);

/* ======================================================
   Concurrency Limiter
   ====================================================== */
function createConcurrencyLimiter(max) {
    let active = 0;
    const queue = [];
    return async fn => {
        while (active >= max) await new Promise(r => queue.push(r));
        active++;
        try { return await fn(); }
        finally {
            active--;
            if (queue.length) queue.shift()();
        }
    };
}

/* ======================================================
   Init Google Document AI
   ====================================================== */
let documentAiClient;
(async () => {
    if (!await mexists(KEYFILE))
        throw new Error(`Credentials not found: ${KEYFILE}`);
    documentAiClient = new DocumentProcessorServiceClient({ keyFilename: KEYFILE });
})();

/* ======================================================
   Utilities
   ====================================================== */
const execp = (cmd, desc = "Command") =>
    new Promise((res, rej) =>
        exec(cmd, { maxBuffer: 1024 * 1024 * 400 }, (e, o, s) =>
            e ? rej(new Error(`${desc} failed: ${s || e.message}`))
              : res((o || "").trim()))
    );

const _normalizeExtractedText = t =>
    (t || "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

/* ======================================================
   PDF → PNG
   ====================================================== */
async function _getPdfPageCount(pdf) {
    const out = await execp(
        `mutool show "${pdf}" trailer/Root/Pages/Count`,
        "Get PDF page count"
    );
    const n = parseInt(out);
    if (!n || n < 1) throw new Error(`Invalid page count: ${out}`);
    return n;
}

async function _convertPdfToPngImages(pdf, outDir, dpi) {
    LOG.info(`Converting PDF to PNG @ ${dpi} DPI using mutool (parallel)...`);
    await mmkdir(outDir, { recursive: true });

    const pageCount = await _getPdfPageCount(pdf);
    LOG.info(`PDF has ${pageCount} page(s)`);
    LOG.info(`Converting pages with concurrency limit: ${CONCURRENCY_PDF_CONVERSION}`);

    const limiter = createConcurrencyLimiter(CONCURRENCY_PDF_CONVERSION);

    await Promise.all(
        Array.from({ length: pageCount }, (_, i) =>
            limiter(async () => {
                const pageNum = i + 1;
                await execp(
                    `mutool draw -o "${outDir}/page-${pageNum}.png" -r ${dpi} -F png "${pdf}" ${pageNum}`,
                    `Convert page ${pageNum}`
                );
                LOG.info(`  Page ${pageNum}/${pageCount} converted`);
            })
        )
    );

    const files = (await mdir(outDir))
        .filter(f => f.endsWith(".png"))
        .sort((a, b) => a.match(/\d+/)[0] - b.match(/\d+/)[0])
        .map(f => path.join(outDir, f));

    let totalSize = 0;
    for (const f of files) totalSize += (await mstat(f)).size;

    LOG.info(
        `Generated ${files.length} page(s) | Total: ${(totalSize / 1024 / 1024).toFixed(2)} MB`
    );

    return files;
}

/* ======================================================
   Image Enhancement
   ====================================================== */
async function _enhanceImageUsingSharp(input, output) {
    const buf = await mread(input);
    const sigma = parseFloat(SHARP.split("x")[1]) || 1.0;

    const out = await sharp(buf, { sequentialRead: true })
        .grayscale()
        .resize(TARGET_WIDTH, null, { fit: "inside", kernel: "lanczos3" })
        .normalize()
        .median(MEDIAN || 0)
        .sharpen({ sigma })
        .gamma(parseFloat(UNGAMMA) || 1.0)
        .threshold(128)
        .png({ compressionLevel: 6 })
        .toBuffer();

    await mwrite(output, out);
    await maccess(output, fs.constants.R_OK);
}

/* ======================================================
   OCR
   ====================================================== */
async function _performDocumentAiOcrOnImage(image) {
    const bytes = await mread(image);
    const [res] = await documentAiClient.processDocument({
        name: PROCESSOR,
        rawDocument: {
            content: bytes.toString("base64"),
            mimeType: "image/png"
        }
    });
    return res.document;
}

/* ======================================================
   MAIN PIPELINE (RACE-SAFE + LOGGED)
   ====================================================== */
async function _runOcrProcessingPipeline(pdfBuffer, includeMarkers) {
    const sessionId = crypto.randomBytes(8).toString("hex");
    const session = path.join(os.tmpdir(), `ocr-${sessionId}`);
    const pdfPath = path.join(session, "input.pdf");
    const pagesDir = path.join(session, "pages");
    const enhancedDir = path.join(session, "ocr_best");

    try {
        await mmkdir(pagesDir, { recursive: true });
        await mmkdir(enhancedDir, { recursive: true });
        await mwrite(pdfPath, pdfBuffer);

        LOG.info("Temporary PDF created\n");

        const pageImages = await _convertPdfToPngImages(pdfPath, pagesDir, DPI);
        const totalPages = pageImages.length;

        LOG.info("\nStarting true pipeline processing...");
        LOG.info(
            `Concurrency limits: Enhancement=${CONCURRENCY_IMAGE_ENHANCEMENT}, OCR=${CONCURRENCY_GOOGLE_OCR}\n`
        );

        const enhanceLimiter = createConcurrencyLimiter(CONCURRENCY_IMAGE_ENHANCEMENT);
        const ocrLimiter = createConcurrencyLimiter(CONCURRENCY_GOOGLE_OCR);

        const pageResults = new Array(totalPages);

        // ✅ Per-page promises (race-safe)
        const enhancedPromises = Array.from({ length: totalPages }, () => {
            let resolve;
            const promise = new Promise(r => resolve = r);
            return { promise, resolve };
        });

        const enhanceTasks = pageImages.map((img, i) =>
            enhanceLimiter(async () => {
                const pageNum = i + 1;
                const out = path.join(enhancedDir, `page-${pageNum}-ocr-best.png`);
                LOG.info(`  [Page ${pageNum}/${totalPages}] Enhancing ${path.basename(img)}`);
                await _enhanceImageUsingSharp(img, out);
                LOG.info(`  [Page ${pageNum}/${totalPages}] Enhancement complete`);
                enhancedPromises[i].resolve(out);
            })
        );

        const ocrTasks = pageImages.map((_, i) =>
            ocrLimiter(async () => {
                const pageNum = i + 1;
                const enhanced = await enhancedPromises[i].promise;
                LOG.info(`  [Page ${pageNum}/${totalPages}] Starting OCR`);
                const doc = await _performDocumentAiOcrOnImage(enhanced);
                LOG.info(`  [Page ${pageNum}/${totalPages}] OCR complete ✓`);
                pageResults[i] = _normalizeExtractedText(doc.text || "");
            })
        );

        await Promise.all([...enhanceTasks, ...ocrTasks]);

        LOG.info("\nAll pages processed (true pipeline) ✓\n");

        let text = "";
        for (let i = 0; i < pageResults.length; i++) {
            text += includeMarkers
                ? `\n\n===== PAGE ${i + 1} =====\n\n${pageResults[i]}`
                : (i ? "\n\n" : "") + pageResults[i];
        }

        LOG.info(`Total pages: ${pageResults.length}`);
        LOG.info(`Text length: ${text.trim().length} characters\n`);

        await mrm(session, { recursive: true, force: true });
        LOG.info("Temporary files cleaned up\n");

        return {
            success: true,
            text: text.trim(),
            pages: pageResults.length,
            length: text.trim().length
        };

    } catch (e) {
        LOG.error("\nERROR:", e.message);
        await mrm(session, { recursive: true, force: true });
        throw e;
    }
}

/* ======================================================
   Stream API (unchanged)
   ====================================================== */
async function _streamToBase64(rs) {
    const chunks = [];
    for await (const c of rs) chunks.push(c);
    return Buffer.concat(chunks).toString("base64");
}

async function getContent(stream, fileName) {
    if (path.extname(fileName).toLowerCase() === ".txt") {
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        return Buffer.concat(chunks);
    }
    const base64 = await _streamToBase64(stream);
    const res = await _runOcrProcessingPipeline(
        Buffer.from(base64, "base64"),
        false
    );
    return Buffer.from(res.text);
}

module.exports = { getContent };