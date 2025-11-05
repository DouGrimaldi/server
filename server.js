// --- Spellbound Relay Server (Upgraded for HTTP Pings) ---

// Import both the WebSocket and the standard HTTP library
const WebSocket = require('ws');
const http = require('http');

// 1. Create a standard HTTP server. This will be our main server.
const server = http.createServer((req, res) => {
    // This function handles any standard HTTP requests (like from UptimeRobot)
    // We send a simple "OK" response to show that the server is alive.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Spellbound Relay Server is alive.');
    console.log('Received HTTP ping. Responded with 200 OK.');
});


// 2. Create a WebSocket server, but tell it NOT to start its own server.
// Instead, we will attach it to our existing HTTP server.
const wss = new WebSocket.Server({ noServer: true });

// This Map will store all our game rooms. (This logic is unchanged)
const rooms = new Map();


// 3. Listen for the 'upgrade' event on our HTTP server.
// This event happens when a client tries to connect with WebSockets (ws://)
server.on('upgrade', (request, socket, head) => {
    console.log('WebSocket upgrade request received. Handing off to ws server...');
    // We hand off the request to the 'ws' library to handle the WebSocket handshake.
    wss.handleUpgrade(request, socket, head, (ws) => {
        // Once the handshake is complete, the 'ws' library gives us the connection,
        // and we emit it to our own connection logic.
        wss.emit('connection', ws, request);
    });
});


// --- All of your existing WebSocket logic goes here, completely unchanged ---
wss.on('connection', ws => {
    console.log('A new WebSocket client connected.');

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'create_room') {
                const roomCode = generateRoomCode();
                ws.roomCode = roomCode; 
                rooms.set(roomCode, { host: ws, clients: [] });
                console.log(`Room ${roomCode} created by host.`);
                ws.send(JSON.stringify({ type: 'room_created', code: roomCode }));
                return;
            }
            else if (data.type === 'join_room') {
                const roomCode = data.code.toUpperCase();
                const room = rooms.get(roomCode);
                if (room) {
                    if (room.clients.some(client => client.playerName === data.name.toUpperCase())) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Name is already taken.' }));
                        return;
                    }
                    ws.roomCode = roomCode;
                    ws.playerName = data.name.toUpperCase();
                    room.clients.push(ws);
                    console.log(`Player ${ws.playerName} joined room ${ws.roomCode}.`);
                    room.host.send(JSON.stringify({
                        type: 'player_joined',
                        name: ws.playerName,
                        picture: data.picture
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
                }
                return;
            }

            const room = rooms.get(ws.roomCode);
            if (!room) return;

            if (room.host === ws) {
                if (data.type === 'sync_board_state') {
                    const client = room.clients.find(c => c.playerName === data.name);
                    if (client) { client.send(message.toString()); }
                } else {
                    room.clients.forEach(client => { client.send(message.toString()); });
                }
            } else {
                const playerIndex = room.clients.findIndex(c => c === ws);
                data.playerIndex = playerIndex;
                room.host.send(JSON.stringify(data));
            }

        } catch (error) {
            console.error('Failed to parse message or handle logic:', error);
        }
    });

    ws.on('close', () => {
        console.log('A WebSocket client disconnected.');
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (room.host === ws) {
            room.clients.forEach(client => {
                client.send(JSON.stringify({ type: 'room_closed' }));
                client.close();
            });
            rooms.delete(ws.roomCode);
            console.log(`Room ${ws.roomCode} has been closed.`);
        } else {
            room.clients = room.clients.filter(client => client !== ws);
            console.log(`Player ${ws.playerName} disconnected. Connections: ${room.clients.length}`);
        }
    });
});

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}


// 4. Start the HTTP server. Render provides the port in an environment variable.
// We fall back to 8080 for local testing.
const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log(`Spellbound Relay Server is running on port ${port}...`);
});
