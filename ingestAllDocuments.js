// installAll.js
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const documentsDirectoryPath = process.argv[2];

if (!documentsDirectoryPath) {
    console.log("❌ Invalid arguments.");
    console.error("Usage: node installAll.js <Documents Directory Path having Acts and Regulations>");
    process.exit(1);
}

const resolvedDocumentsDir = path.resolve(documentsDirectoryPath);

if (!fs.existsSync(resolvedDocumentsDir) || !fs.statSync(resolvedDocumentsDir).isDirectory()) {
    console.error(`❌ Invalid documentsDirectoryPath: ${resolvedDocumentsDir}`);
    process.exit(1);
}

const actsDir = path.join(resolvedDocumentsDir, "Acts");
const regulationsDir = path.join(resolvedDocumentsDir, "Regulations");

function ensureDirExists(dirPath, label) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        console.error(`❌ Missing ${label} directory: ${dirPath}`);
        process.exit(1);
    }
}

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        console.log(`\n🚀 Running: ${command} ${args.join(" ")}`);

        const child = spawn(command, args, {
            stdio: "inherit",
            shell: false,
        });

        child.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

async function main() {
    ensureDirExists(actsDir, "Acts");
    ensureDirExists(regulationsDir, "Regulations");

    try {
        await runCommand("node", ["ingestAct.js", actsDir, "--all"]);
        await runCommand("node", ["ingestRegulation.js", regulationsDir, "--all"]);
        console.log("\n✅ All documents ingested successfully");
    } catch (err) {
        console.error("\n❌ installAll failed:", err.message);
        process.exit(1);
    }
}

main();
