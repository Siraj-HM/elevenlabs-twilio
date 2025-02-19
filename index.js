import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";

// Load environment variables from .env file
dotenv.config();

const { ELEVENLABS_AGENT_ID } = process.env;

// Check for the required ElevenLabs Agent ID
if (!ELEVENLABS_AGENT_ID) {
    console.error("Missing ELEVENLABS_AGENT_ID in environment variables");
    process.exit(1);
}

// Initialize Fastify server
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT || 3000; // Updated to use port 3000

// Root route for health check
fastify.get("/", async (_, reply) => {
    reply.send({ message: "Server is running" });
});

// Route to handle incoming calls from Twilio
fastify.all("/twilio/inbound_call", async (request, reply) => {
    // Generate TwiML response to connect the call to a WebSocket stream
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="wss://${request.headers.host}/media-stream" />
        </Connect>
    </Response>`;

    reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for handling media streams from Twilio
fastify.register(async (fastifyInstance) => {
    fastifyInstance.get("/media-stream", { websocket: true }, (connection, req) => {
        console.info("[Server] Twilio connected to media stream.");

        let streamSid = null;

        // Connect to ElevenLabs Conversational AI WebSocket
        const elevenLabsWs = new WebSocket(
            `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`
        );

        // Handle open event for ElevenLabs WebSocket
        elevenLabsWs.on("open", () => {
            console.log("[II] Connected to Conversational AI.");
        });

        // Handle messages from ElevenLabs
        elevenLabsWs.on("message", (data) => {
            try {
                const message = JSON.parse(data);
                handleElevenLabsMessage(message, connection);
            } catch (error) {
                console.error("[II] Error parsing message:", error);
            }
        });

        // Handle errors from ElevenLabs WebSocket
        elevenLabsWs.on("error", (error) => {
            console.error("[II] WebSocket error:", error);
        });

        // Handle close event for ElevenLabs WebSocket
        elevenLabsWs.on("close", () => {
            console.log("[II] Disconnected.");
        });

        // Function to handle messages from ElevenLabs
		const handleElevenLabsMessage = (message, connection) => {
		    switch (message.type) {
		        case "conversation_initiation_metadata":
		            console.info("[II] Received conversation initiation metadata.");
		            break;
		        case "audio":
		            console.log("[II] Received AI-generated audio from ElevenLabs!");
		            if (message.audio_event?.audio_base_64) {
		                console.log("[II] Forwarding AI-generated audio to Twilio...");
		                const audioData = {
		                    event: "media",
		                    streamSid,
		                    media: {
		                        payload: message.audio_event.audio_base_64,
		                    },
		                };
		                connection.send(JSON.stringify(audioData));
		            } else {
		                console.error("[II] No audio data received from ElevenLabs!");
		            }
		            break;
		        case "ping":
		            console.log("[II] Received ping from ElevenLabs.");
		            break;
		        default:
		            console.log(`[II] Unhandled message type: ${message.type}`);
		    }
		};


        // Handle messages from Twilio
		connection.on("message", async (message) => {
		    try {
		        const data = JSON.parse(message);
		        switch (data.event) {
		            case "connected":
		                console.log("[Twilio] Connection established, waiting for audio data...");
		                break;
		            case "start":
		                streamSid = data.start.streamSid;
		                console.log(`[Twilio] Stream started with ID: ${streamSid}`);
		                break;
		            case "media":
		                console.log(`[Twilio] Received audio chunk of size: ${data.media.payload.length} bytes`);
		                if (elevenLabsWs.readyState === WebSocket.OPEN) {
		                    const audioMessage = {
		                        user_audio_chunk: Buffer.from(data.media.payload, "base64").toString("base64"),
		                    };
		                    elevenLabsWs.send(JSON.stringify(audioMessage));
		                    console.log("[Twilio] Sent audio chunk to ElevenLabs.");
		                }
		                break;
		            case "stop":
		                elevenLabsWs.close();
		                console.log("[Twilio] Stream stopped.");
		                break;
		            default:
		                console.log(`[Twilio] Received unhandled event: ${data.event}`);
		        }
		    } catch (error) {
		        console.error("[Twilio] Error processing message:", error);
		    }
		});


        connection.on("close", () => {
            elevenLabsWs.close();
            console.log("[Twilio] Client disconnected");
        });

        connection.on("error", (error) => {
            console.error("[Twilio] WebSocket error:", error);
            elevenLabsWs.close();
        });
    });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
        console.error("Error starting server:", err);
        process.exit(1);
    }
    console.log(`[Server] Listening on port ${PORT}`);
});
