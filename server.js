const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const logsDir = path.join(__dirname, "logs");
const dataDir = path.join(__dirname, "data");
const userLogFile = path.join(logsDir, "user_logs.txt");
const contactsFile = path.join(dataDir, "contacts.json");
const aiAvatarFile = path.join(__dirname, "public", "ai-avatar.png");

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const aiAvatar = fs.existsSync(aiAvatarFile)
    ? "/ai-avatar.png"
    : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='60' r='58' fill='%2300ff78'/%3E%3Ccircle cx='60' cy='40' r='18' fill='%2311221e'/%3E%3Cpath d='M32 86c14-22 28-22 28-22s16 0 30 22' fill='none' stroke='%2311221e' stroke-width='10' stroke-linecap='round'/%3E%3C/svg%3E";

function writeUserLog(entry) {
    const line = `[${new Date().toISOString()}] ${entry}\n`;
    fs.appendFile(userLogFile, line, (err) => {
        if (err) console.error("Failed to write user log:", err);
    });
}

function loadContacts() {
    try {
        if (!fs.existsSync(contactsFile)) return [];
        const data = fs.readFileSync(contactsFile, "utf8");
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function saveContacts(contacts) {
    fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2), "utf8");
}

const contacts = loadContacts();
if (!contacts.some((c) => c.username === "BhatsAI")) {
    contacts.unshift({ username: "BhatsAI", pfp: aiAvatar, online: true, lastSeen: null });
}

function updateContact(username, pfp, online) {
    if (!username) return;
    const contact = contacts.find((c) => c.username === username);
    if (contact) {
        contact.pfp = pfp || contact.pfp;
        contact.online = online;
        contact.lastSeen = online ? null : new Date().toISOString();
    } else {
        contacts.push({
            username,
            pfp: pfp || null,
            online,
            lastSeen: online ? null : new Date().toISOString()
        });
    }
    saveContacts(contacts);
}

function getPublicContacts() {
    return contacts.map(({ username, pfp, online, lastSeen }) => ({ username, pfp, online, lastSeen }));
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'BhatsChat/5.0' } }, (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'BhatsChat/5.0' } }, (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, body }));
        }).on("error", reject);
    });
}

const OLLAMA_MODEL = "qwen2.5:0.5b";

async function fetchAiResponse(prompt) {

    return new Promise((resolve) => {

        const payload = JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: prompt,
            stream: false
        });

        const req = http.request(
            {
                hostname: "localhost",
                port: 11434,
                path: "/api/generate",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                }
            },
            (res) => {

                let body = "";

                res.on("data", chunk => {
                    body += chunk;
                });

                res.on("end", () => {

                    try {

                        const data = JSON.parse(body);

                        resolve(
                            data.response ||
                            "No response from model."
                        );

                    } catch {

                        resolve(
                            "Failed to parse AI response."
                        );

                    }

                });

            }
        );

        req.on("error", () => {
            resolve(
                "Could not connect to Ollama."
            );
        });

        req.write(payload);
        req.end();

    });

}

async function fetchWikiSummary(query) {
    if (!query) return null;
    const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    try {
        const result = await fetchJson(apiUrl);
        if (result.status !== 200 || !result.body || !result.body.extract) return null;
        return result.body.extract;
    } catch (err) {
        return null;
    }
}

async function fetchWeather(latitude, longitude) {
    if (!latitude || !longitude) return null;
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=celsius`;
    try {
        const result = await fetchJson(apiUrl);
        if (result.status !== 200 || !result.body || !result.body.current) return null;
        const current = result.body.current;
        const temp = current.temperature_2m;
        const humidity = current.relative_humidity_2m;
        const windSpeed = current.wind_speed_10m;
        const weatherCode = current.weather_code;
        const weatherDesc = getWeatherDescription(weatherCode);
        return `🌡️ ${temp}°C | ${weatherDesc} | 💨 ${windSpeed}km/h | 💧 ${humidity}%`;
    } catch (err) {
        return null;
    }
}

function getWeatherDescription(code) {
    const weatherCodes = {
        0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
        45: "Foggy", 48: "Freezing Fog", 51: "Light Drizzle", 53: "Moderate Drizzle",
        55: "Heavy Drizzle", 61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
        71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow", 77: "Snow Grains",
        80: "Slight Rain Showers", 81: "Moderate Rain Showers", 82: "Violent Rain Showers",
        85: "Slight Snow Showers", 86: "Heavy Snow Showers", 95: "Thunderstorm",
        96: "Thunderstorm with Hail", 99: "Thunderstorm with Heavy Hail"
    };
    return weatherCodes[code] || "Unknown";
}

app.use(express.static("public"));

// In-memory temporary bans: Map<username, expiryTimestamp>
const bannedUsers = new Map();

// Age verification: Map<socketId, isVerified>
const ageVerified = new Map();

io.on("connection", (socket) => {
    const ip = socket.handshake.address || socket.request.socket.remoteAddress || "unknown";
    const userAgent = socket.handshake.headers["user-agent"] || "unknown";
    writeUserLog(`connection socket=${socket.id} ip=${ip} ua="${userAgent}"`);
    socket.emit("contactsUpdated", getPublicContacts());
    
    // Request age verification on connection
    socket.emit("ageVerificationRequired");
    
    socket.on("verifyAge", (data) => {
        const age = parseInt(data.age, 10);
        if (age >= 18) {
            ageVerified.set(socket.id, true);
            socket.emit("ageVerified", { status: true });
        } else {
            socket.emit("ageVerified", { status: false, message: "You must be 18 or older to join" });
        }
    });

    socket.on("join", (data) => {
        // Check age verification first
        if (!ageVerified.get(socket.id)) {
            socket.emit("message", {
                user: "System",
                text: "You must verify your age before joining",
                pfp: null
            });
            socket.disconnect(true);
            return;
        }
        
        const username = data.username || data;
        const pfp = data.pfp || null;
        writeUserLog(`join socket=${socket.id} username="${username}" pfp=${pfp ? "yes" : "no"}`);
        updateContact(username, pfp, true);
        io.emit("contactsUpdated", getPublicContacts());
        // If user is banned, refuse connection
        const banUntil = bannedUsers.get(username);
        if (banUntil && banUntil > Date.now()) {
            socket.emit("message", {
                user: "System",
                text: `You are banned until ${new Date(banUntil).toLocaleString()}`,
                pfp: null
            });
            socket.disconnect(true);
            return;
        } else if (banUntil) {
            // expired ban - cleanup
            bannedUsers.delete(username);
        }

        socket.username = username;
        socket.pfp = pfp;

        io.emit("message", {
            user: "System",
            text: `${username} joined BhatsChat`
        });
    });

    socket.on("updateProfile", (data) => {
        if (!socket.username || !data) return;
        const pfp = data.pfp || socket.pfp;
        socket.pfp = pfp;
        updateContact(socket.username, pfp, true);
        io.emit("contactsUpdated", getPublicContacts());
    });

    socket.on("message", async (text) => {

        text = String(text || "").trim();
        if (!text) return;

        const user = socket.username || "Anonymous";
        const pfp = socket.pfp || null;
        const isAdmin = user === "Admin";
        writeUserLog(`message socket=${socket.id} username="${user}" text="${text.replace(/"/g, '\\"')}"`);

    // If sender is banned, block messages
    const myBan = bannedUsers.get(user);
    if (myBan && myBan > Date.now()) {
        socket.emit("message", {
            user: "System",
            text: `You are banned until ${new Date(myBan).toLocaleString()}`,
            pfp: null
        });
        return;
    } else if (myBan) {
        bannedUsers.delete(user);
    }

    // Commands
    if (text.startsWith("/")) {
        const args = text.split(/\s+/);
        const cmd = args[0].toLowerCase();

        if (cmd === "/time") {
            const time = new Date().toLocaleTimeString();
            io.emit("message", {
                user: "System",
                text: `Server time: ${time}`,
                pfp: null
            });
            return;
        }

        if (cmd === "/help") {
            socket.emit("message", {
                user: "System",
                text: "Commands: /help, /time, /aloo <count>, /announce <msg>, /clear, /ban <username> <minutes>, /ai greet, /ai calculate <expression>, /ai whos <topic>, /ai weather, /ai ask <prompt>",
                pfp: null
            });
            return;
        }

        if (cmd === "/calc") {
            socket.emit("message", {
                user: "System",
                text: "Use /ai calculate <expression> instead.",
                pfp: null
            });
            return;
        }

        if (cmd === "/ai") {
            const action = (args[1] || "").toLowerCase();
            if (action === "greet") {
                io.emit("message", {
                    user: "BhatsAI",
                    text: `Hello ${socket.username || "friend"}! I can greet you with /ai greet, calculate with /ai calculate <expression>, look up someone with /ai whos <topic>, or check weather with /ai weather.`, 
                    pfp: aiAvatar
                });
                return;
            }

            if (action === "calculate" || action === "calc") {
                const expr = args.slice(2).join(" ");
                if (!expr || !/^[0-9+\-*/().\s]+$/.test(expr)) {
                    socket.emit("message", {
                        user: "BhatsAI",
                        text: "Invalid expression. Use only numbers and + - * / ( ) .",
                        pfp: aiAvatar
                    });
                    return;
                }

                try {
                    const result = eval(expr);
                    io.emit("message", {
                        user: "BhatsAI",
                        text: `${socket.username || "User"}, the result is ${result}.`, 
                        pfp: aiAvatar
                    });
                } catch {
                    socket.emit("message", {
                        user: "BhatsAI",
                        text: "Could not calculate that expression.",
                        pfp: aiAvatar
                    });
                }
                return;
            }

            if (action === "whos" || action === "whois") {
                const topic = args.slice(2).join(" ");
                if (!topic) {
                    socket.emit("message", {
                        user: "BhatsAI",
                        text: "Ask me who someone is with /ai whos <topic>.",
                        pfp: aiAvatar
                    });
                    return;
                }
                socket.emit("message", {
                    user: "BhatsAI",
                    text: `Looking up ${topic}...`,
                    pfp: aiAvatar
                });
                const summary = await fetchWikiSummary(topic);
                io.emit("message", {
                    user: "BhatsAI",
                    text: summary ? summary : `Sorry, I couldn't find a Wikipedia summary for ${topic}.`,
                    pfp: aiAvatar
                });
                return;
            }

            if (action === "weather") {
                socket.emit("message", {
                    user: "BhatsAI",
                    text: "Fetching weather data...",
                    pfp: aiAvatar
                });
                const weather = await fetchWeather(51.5074, -0.1278);
                io.emit("message", {
                    user: "BhatsAI",
                    text: weather ? `📍 Local Weather: ${weather}` : "Sorry, I couldn't fetch weather data.",
                    pfp: aiAvatar
                });
                return;
            }

            if (action === "ask") {
                const promptText = args.slice(2).join(" ");
                if (!promptText) {
                    socket.emit("message", {
                        user: "BhatsAI",
                        text: "Use /ai ask <prompt> to query the local AI service.",
                        pfp: aiAvatar
                    });
                    return;
                }
                socket.emit("message", {
                    user: "BhatsAI",
                    text: "Thinking...",
                    pfp: aiAvatar
                });
                const aiResponse = await fetchAiResponse(promptText);
                io.emit("message", {
                    user: "BhatsAI",
                    text: aiResponse || "Sorry, the local AI service could not answer that.",
                    pfp: aiAvatar
                });
                return;
            }

            if (action && !["greet", "calculate", "calc", "whos", "whois", "weather", "ask"].includes(action)) {
                const promptText = args.slice(1).join(" ");
                socket.emit("message", {
                    user: "BhatsAI",
                    text: "Processing your request...",
                    pfp: aiAvatar
                });
                const aiResponse = await fetchAiResponse(promptText);
                io.emit("message", {
                    user: "BhatsAI",
                    text: aiResponse || "Sorry, the local AI service could not answer that.",
                    pfp: aiAvatar
                });
                return;
            }

            socket.emit("message", {
                user: "BhatsAI",
                text: "AI commands: /ai greet, /ai calculate <expression>, /ai whos <topic>, /ai weather, /ai ask <prompt>",
                pfp: aiAvatar
            });
            return;
        }

        // /aloo [count] - spam potato emoji in chat (any user)
        if (cmd === "/aloo") {
            const cnt = Math.max(1, Math.min(1000, parseInt(args[1], 10) || 10));
            const payload = Array.from({ length: cnt }).map(() => 'Aloo Khaoge?').join(' ');
            io.emit("message", {
                user: "Aloo",
                text: payload,
                pfp: null
            });
            return;
        }

        // admin-only checks for announce/clear/ban
        if (!isAdmin && (cmd === "/announce" || cmd === "/clear" || cmd === "/ban")) {
            socket.emit("message", {
                user: "System",
                text: "You are not an admin.",
                pfp: null
            });
            return;
        }

        // /ban <username> <minutes?> - admin only
        if (cmd === "/ban") {
            const target = args[1];
            const minutes = parseInt(args[2], 10) || 10;
            if (!target) {
                socket.emit("message", {
                    user: "System",
                    text: "Usage: /ban <username> <minutes>",
                    pfp: null
                });
                return;
            }

            const until = Date.now() + minutes * 60 * 1000;
            bannedUsers.set(target, until);

            // schedule cleanup
            setTimeout(() => {
                const current = bannedUsers.get(target);
                if (current && current <= Date.now()) bannedUsers.delete(target);
            }, minutes * 60 * 1000 + 1000);

            io.emit("message", {
                user: "System",
                text: `${target} has been banned for ${minutes} minute(s)`,
                pfp: null
            });

            // If target is connected, notify and disconnect
            for (const s of io.sockets.sockets.values()) {
                if (s.username === target) {
                    try {
                        s.emit("message", {
                            user: "System",
                            text: `You have been banned for ${minutes} minute(s)`,
                            pfp: null
                        });
                        s.disconnect(true);
                    } catch (e) {
                        // ignore
                    }
                }
            }

            return;
        }

        if (cmd === "/announce") {
            const msg = args.slice(1).join(" ");
            io.emit("message", {
                user: "📢 Announcement",
                text: msg,
                pfp: null
            });
            return;
        }

        if (cmd === "/clear") {
            io.emit("clearChat");
            io.emit("message", {
                user: "System",
                text: "--- CHAT CLEARED ---",
                pfp: null
            });
            return;
        }

        socket.emit("message", {
            user: "System",
            text: "Unknown command",
            pfp: null
        });
        return;
    }

    // Normal chat message
    io.emit("message", {
        user,
        text,
        pfp
    });

});

    socket.on("typing", () => {
        if (!socket.username) return;
        socket.broadcast.emit("typing", { user: socket.username });
    });

    socket.on("stopTyping", () => {
        if (!socket.username) return;
        socket.broadcast.emit("stopTyping", { user: socket.username });
    });

    socket.on("image", (data) => {
        if (!data || !data.image) return;
        const user = socket.username || "Anonymous";
        const pfp = socket.pfp || null;
        io.emit("message", {
            user,
            image: data.image,
            pfp
        });
    });

    socket.on("file", (data) => {
        if (!data || !data.data || !data.name) return;
        const user = socket.username || "Anonymous";
        writeUserLog(`file socket=${socket.id} username="${user}" filename="${data.name}" type="${data.type || 'application/octet-stream'}" size=${data.size || 0}`);
        const pfp = socket.pfp || null;
        io.emit("message", {
            user,
            file: {
                name: data.name,
                type: data.type || 'application/octet-stream',
                size: data.size || 0,
                data: data.data
            },
            pfp
        });
    });

    socket.on("disconnect", () => {
        ageVerified.delete(socket.id);
        writeUserLog(`disconnect socket=${socket.id} username="${socket.username || 'Anonymous'}"`);
        if (socket.username) {
            updateContact(socket.username, socket.pfp, false);
            io.emit("contactsUpdated", getPublicContacts());
            io.emit("message", {
                user: "System",
                text: `${socket.username} left BhatsChat`
            });
        }
    });

});

server.listen(3000, () => {
    console.log("BhatsChat running");
    console.log("http://localhost:3000");
});