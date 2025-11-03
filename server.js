const WebSocket = require('ws');

// Use the port Render provides, or 8080 for local testing
const PORT = process.env.PORT || 8080;

// Create a new WebSocket server
const wss = new WebSocket.Server({ port: PORT });

// This object will store our game rooms
// Key: roomCode (e.g., "ABCD"), Value: { host: WebSocket, players: WebSocket[] }
const rooms = {};

/**
 * Generates a random 4-letter room code.
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure code is unique (unlikely collision, but good practice)
    if (rooms[code]) {
        return generateRoomCode();
    }
    return code;
}

/**
 * Sends a JSON message to a single WebSocket client.
 * @param {WebSocket} ws The client to send to.
 * @param {object} data The data object to send.
 */
function sendMessage(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

/**
 * Sends a JSON message to all players in a room (but not the host).
 * @param {object} room The game room object.
 * @param {object} data The data object to send.
 */
function broadcastToPlayers(room, data) {
    const message = JSON.stringify(data);
    room.players.forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(message);
        }
    });
}

// --- Main Server Logic ---

wss.on('connection', (ws) => {
    console.log('A new client connected.');
    
    // Add a property to the client to track what room it's in
    ws.roomCode = null;
    ws.isHost = false;
    ws.playerIndex = -1;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse message:', message);
            return;
        }

        // --- BETTER DIAGNOSTICS ---
        console.log(`Received message type: ${data.type}`);
        console.log('Received data:', JSON.stringify(data)); // Log the full message body

        switch (data.type) {
            // --- Host Messages ---
            case 'create_room':
                const roomCode = generateRoomCode();
                ws.roomCode = roomCode;
                ws.isHost = true;
                
                rooms[roomCode] = {
                    host: ws,
                    players: []
                };
                
                console.log(`Host created room: ${roomCode}`);
                sendMessage(ws, { type: 'room_created', code: roomCode });
                break;

            case 'start_game':
            case 'next_turn':
            case 'buzzer_lock':
                if (ws.isHost && ws.roomCode && rooms[ws.roomCode]) {
                    // Host is sending a message, broadcast it to all players in that room
                    broadcastToPlayers(rooms[ws.roomCode], data);
                }
                break;

            // --- Player Messages ---
            // --- FIX ---
            // Changed 'join_room' to 'join' to match what your client is sending
            case 'join':
                const code = data.code.toUpperCase();
                if (rooms[code]) {
                    const room = rooms[code];
                    const playerIndex = room.players.length;
                    
                    ws.roomCode = code;
                    ws.playerIndex = playerIndex;
                    room.players.push({ ws: ws, name: data.name, picture: data.picture });

                    console.log(`Player "${data.name}" joined room: ${code}`);

                    // Tell the player they joined successfully
                    sendMessage(ws, { type: 'join_success', playerIndex: playerIndex });
                    
                    // Tell the host a new player joined
                    sendMessage(room.host, { 
                        type: 'player_joined', 
                        name: data.name, 
                        picture: data.picture,
                        playerIndex: playerIndex 
                    });
                } else {
                    console.log(`Player tried to join non-existent room: ${code}`);
                    sendMessage(ws, { type: 'error', message: 'Room not found.' });
                }
                break;
            
            case 'buzz':
                if (!ws.isHost && ws.roomCode && rooms[ws.roomCode]) {
                    const room = rooms[ws.roomCode];
                    // Player is buzzing, forward this *only* to the host
                    sendMessage(room.host, {
                        type: 'player_buzzed',
                        playerIndex: ws.playerIndex
                    });
                }
                break;
            
            // --- BETTER DIAGNOSTICS ---
            // Added a default case to catch any unknown message types
            default:
                console.log(`Unhandled message type: ${data.type}`);
                sendMessage(ws, { type: 'error', message: `Unknown message type: ${data.type}` });
                break;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
        if (ws.roomCode && rooms[ws.roomCode]) {
            const room = rooms[ws.roomCode];
            if (ws.isHost) {
                // Host disconnected, tell all players the room is closed
                console.log(`Host for room ${ws.roomCode} disconnected. Closing room.`);
                broadcastToPlayers(room, { type: 'error', message: 'The host disconnected.' });
                delete rooms[ws.roomCode];
            } else {
                // Player disconnected, remove them from the list
                const playerIndex = room.players.findIndex(p => p.ws === ws);
                if (playerIndex > -1) {
                    const removedPlayer = room.players.splice(playerIndex, 1)[0];
                    console.log(`Player "${removedPlayer.name}" left room: ${ws.roomCode}`);
                    
                    // Tell the host a player left
                    sendMessage(room.host, { type: 'player_left', playerIndex: ws.playerIndex });
                    
                    // Renumber remaining players (this is complex, skipping for now for simplicity)
                    // For now, we just notify the host.
                }
            }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

console.log(`Spelling Bee Relay Server is running on port ${PORT}...`);

