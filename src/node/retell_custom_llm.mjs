import "dotenv/config";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./vapi_assistant_config.mjs"; // Reuse existing prompt logic

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Handle LLM WebSocket Connection
wss.on("connection", (ws, req) => {
    const callId = req.url.split("/").pop();
    console.log(`[${callId}] Call connected to Custom LLM`);

    let responseId = 0;
    let callDynamicVars = {};

    ws.on("message", async (message) => {
        try {
            const event = JSON.parse(message);

            if (event.event_type === "call_started") {
                console.log(`[${callId}] Call Started.`);
                // Variables passed in retellClient.call.createPhoneCall()
                callDynamicVars = event.call?.retell_llm_dynamic_variables || {};
            }

            // We handle the "update" event which has the transcript/conversation history
            if (event.event_type === "update" && event.transcript) {
                // Determine if we need to respond
                // Usually, Retell sends update events when user speaks or stops speaking
                // We only respond if it's the AI's turn
                // "interaction_type" in transcript or just checking last speaker isn't AI
                const transcript = event.transcript;
                const lastMessage = transcript[transcript.length - 1];

                if (lastMessage && lastMessage.role === "user") {
                    await handleLLMResponse(ws, transcript, callDynamicVars);
                }
            }
        } catch (err) {
            console.error("Error parsing message:", err);
        }
    });

    ws.on("close", () => {
        console.log(`[${callId}] Call disconnected`);
    });

    async function handleLLMResponse(ws, transcript, dynamicVars) {
        responseId++;
        const currentResponseId = responseId;

        // Customize the prompt with dynamic variables
        let customizedPrompt = SYSTEM_PROMPT
            .replace(/{{business_name}}/g, dynamicVars.business_name || "your shop")
            .replace(/{{city}}/g, dynamicVars.city || "your city")
            .replace(/{{problem}}/g, dynamicVars.problem || "no website");

        const messages = [
            { role: "system", content: customizedPrompt },
            ...transcript.map(t => ({
                role: t.role === "agent" ? "assistant" : "user",
                content: t.content
            }))
        ];

        try {
            const stream = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages,
                stream: true,
                temperature: 0.7,
            });

            for await (const chunk of stream) {
                // If a new response started, cancel this one
                if (responseId !== currentResponseId) break;

                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                    ws.send(JSON.stringify({
                        response_id: currentResponseId,
                        content: content,
                        content_complete: false,
                        end_call: false
                    }));
                }
            }

            if (responseId === currentResponseId) {
                ws.send(JSON.stringify({
                    response_id: currentResponseId,
                    content: "",
                    content_complete: true,
                    end_call: false // You could set logic here to hang up if needed
                }));
            }
        } catch (err) {
            console.error("LLM Error:", err);
            // Optionally tell Retell we're done generating to avoid hangs
            ws.send(JSON.stringify({
                response_id: currentResponseId,
                content: "I'm sorry, I'm having trouble connecting right now.",
                content_complete: true,
                end_call: false
            }));
        }
    }
});

// A simple healthcheck route
app.get("/", (req, res) => {
    res.send("Retell Custom LLM Server is running");
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Retell Custom LLM WebSocket Server running on port ${PORT}`);
    console.log(`WebSocket Endpoint: ws://localhost:${PORT}/llm-websocket/{call_id}`);
    console.log(`Expose this using ngrok: ngrok http ${PORT}`);
});
