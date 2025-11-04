// --- Spellbound Relay Server ---

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
const rooms = new Map();

console.log('Spellbound Relay Server is running on port 8080...');

wss.on('connection', ws => {
    console.log('A new client connected.');

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            // --- This block is for messages that don't require the client to be in a room yet ---
            if (data.type === 'create_room') {
                const roomCode = generateRoomCode();
                ws.roomCode = roomCode; 
                rooms.set(roomCode, {
                    host: ws,
                    clients: [],
                    isGameInProgress: false // --- NEW: Track game state ---
                });
                console.log(`Room ${roomCode} created by host.`);
                ws.send(JSON.stringify({ type: 'room_created', code: roomCode }));
                return; // Stop processing here
            }
            else if (data.type === 'join_room') {
                const roomCode = data.code.toUpperCase();
                const room = rooms.get(roomCode);
                
                if (room) {
                    // --- MODIFIED: Prevent players with the same name from joining ---
                    if (room.clients.some(client => client.playerName === data.name.toUpperCase())) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Name is already taken.' }));
                        return;
                    }

                    ws.roomCode = roomCode;
                    ws.playerName = data.name.toUpperCase(); // Store name on the connection
                    room.clients.push(ws);
                    console.log(`Player ${ws.playerName} joined room ${ws.roomCode}.`);
                    
                    // Tell the host a player joined. The host will decide if it's a new player or a reconnect.
                    room.host.send(JSON.stringify({
                        type: 'player_joined',
                        name: ws.playerName,
                        picture: data.picture
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
                }
                return; // Stop processing here
            }

            // --- All other messages require the client to be in a room ---
            const room = rooms.get(ws.roomCode);
            if (!room) return;

            // --- NEW: Handle a targeted message from the host to a specific client ---
            if (data.type === 'force_start_client' && room.host === ws) {
                const clientToStart = room.clients.find(c => c.playerName === data.name);
                if (clientToStart) {
                    console.log(`Forcing start for reconnected player: ${data.name}`);
                    clientToStart.send(JSON.stringify({ type: 'game_started' }));
                }
                return;
            }
            
            // --- NEW: Host tells server the game has started ---
            if (data.type === 'start_game' && room.host === ws) {
                room.isGameInProgress = true;
            }


            // Generic relay logic (for buzz, next_turn, etc.)
            if (room.host === ws) {
                // Message is FROM the host (Godot), send to ALL clients
                room.clients.forEach(client => {
                    client.send(message.toString());
                });
            } else {
                // Message is FROM a client (phone), send ONLY to the host
                // --- MODIFIED: Include playerIndex with buzz ---
                const playerIndex = room.clients.indexOf(ws);
                const buzzMessage = {
                    type: 'player_buzzed',
                    name: ws.playerName,
                    playerIndex: playerIndex
                };
                room.host.send(JSON.stringify(buzzMessage));
            }

        } catch (error) {
            console.error('Failed to parse message or handle logic:', error);
        }
    });

    ws.on('close', () => {
        console.log('A client disconnected.');
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        if (room.host === ws) {
            // The host disconnected, close the entire room.
            room.clients.forEach(client => {
                client.send(JSON.stringify({ type: 'room_closed' }));
                client.close();
            });
            rooms.delete(ws.roomCode);
            console.log(`Room ${ws.roomCode} has been closed.`);
        } else {
            // A player disconnected
            // --- MODIFIED: Just remove them from the active connections list ---
            // We no longer notify the host, allowing them to reconnect.
            room.clients = room.clients.filter(client => client !== ws);
            console.log(`Player ${ws.playerName} disconnected from room ${ws.roomCode}. Connections remaining: ${room.clients.length}`);
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
