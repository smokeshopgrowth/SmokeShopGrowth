const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(),'.env');

async function checkNgrok() {
    try {
        const response = await fetch("http://127.0.0.1:4040/api/tunnels");
        const data = await response.json();

        const tunnel = data.tunnels.find(t => t.public_url.startsWith("https"));
        if (tunnel) {
            return tunnel.public_url;
        }
    } catch (e) {
        return null;
    }
    return null;
}

async function updateEnv(url) {
    let envContent = fs.readFileSync(envPath, "utf-8");
    const vapiUrl = `${url}/vapi/webhook`;

    if (envContent.includes("WEBHOOK_URL=")) {
        envContent = envContent.replace(/WEBHOOK_URL=.*/g, `WEBHOOK_URL=${vapiUrl}`);
    } else {
        envContent += `\nWEBHOOK_URL=${vapiUrl}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Updated .env with WEBHOOK_URL=${vapiUrl}`);
}

async function start() {
    console.log("🔍 Checking for existing ngrok tunnel...");
    let url = await checkNgrok();

    if (!url) {
        console.log("🚀 Starting ngrok...");
        const npx = process.platform === "win32" ? "npx.cmd" : "npx";
        const options = { stdio: "ignore", detached: true };
        if (process.platform === "win32") options.shell = true;
        const ngrokProcess = spawn(npx, ["ngrok", "http", "3001"], options);
        ngrokProcess.unref();

        // Wait to allow ngrok to start
        await new Promise(r => setTimeout(r, 3000));
        url = await checkNgrok();
    }

    if (!url) {
        console.error("❌ Failed to get ngrok URL. Make sure ngrok is installed and authenticated.");
        process.exit(1);
    }

    console.log(`🌐 ngrok running at ${url}`);

    await updateEnv(url);

    console.log("🔄 Updating Vapi Assistant...");
    exec("npm run vapi:update", (err, stdout, stderr) => {
        if (err) {
            console.error("❌ Failed to update Vapi:", stderr || err.message);
        } else {
            console.log(stdout);
            console.log("✅ Vapi Assistant Updated!");
        }

        console.log("🚀 Starting Webhook Server...");
        require("./vapi_webhook.js");
    });
}

start();
