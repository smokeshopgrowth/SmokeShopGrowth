import "dotenv/config";
import Retell from "retell-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SYSTEM_PROMPT } from "./vapi_assistant_config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RETELL_API_KEY = process.env.RETELL_API_KEY;

if (!RETELL_API_KEY) {
    console.error("Missing RETELL_API_KEY in .env");
    process.exit(1);
}

const client = new Retell({
    apiKey: RETELL_API_KEY,
});

async function setup() {
    try {
        console.log("1. Creating Retell LLM...");
        const llm = await client.llm.create({
            general_prompt: SYSTEM_PROMPT,
            // Retell will automatically inject variables passed via retell_llm_dynamic_variables
            // like {{business_name}}, {{city}}, {{problem}}
        });
        console.log(`LLM Created: ${llm.llm_id}`);

        console.log("2. Creating Retell Agent...");
        const agent = await client.agent.create({
            llm_websocket_url: `wss://api.retellai.com/retell-llm-new/${llm.llm_id}`,
            voice_id: "11labs-Adrian", // Using a popular 11labs voice Retell supports, or whatever default
            agent_name: "Smoke Shop Agent",
            response_engine: {
                llm_id: llm.llm_id,
                type: "retell-llm"
            }
        });
        console.log(`Agent Created: ${agent.agent_id}`);

        // Update .env with the new Agent ID
        const envPath = path.join(__dirname, "..", "..", ".env");
        let envContent = fs.readFileSync(envPath, "utf-8");

        if (envContent.includes("RETELL_AGENT_ID=")) {
            envContent = envContent.replace(/RETELL_AGENT_ID=.*/, `RETELL_AGENT_ID=${agent.agent_id}`);
        } else {
            envContent += `\nRETELL_AGENT_ID=${agent.agent_id}\n`;
        }

        fs.writeFileSync(envPath, envContent);
        console.log("✅ Successfully updated .env with your new RETELL_AGENT_ID!");
        console.log("\nYou are all set! You can now run:");
        console.log("npm run retell:batch -- --file leads.csv");

    } catch (err) {
        console.error("Error setting up Retell:", err);
    }
}

setup();
