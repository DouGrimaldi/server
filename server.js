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

            // --- MODIFIED: Added routing for new message types ---
            if (room.host === ws) {
                // Message is FROM the host (Godot)
                if (data.type === 'sync_board_state') {
                    // Send to a specific player
                    const client = room.clients.find(c => c.playerName === data.name);
                    if (client) {
                        client.send(message.toString());
                    }
                } else {
                    // Broadcast to ALL clients (start_game, next_turn, board_update, etc.)
                    room.clients.forEach(client => {
                        client.send(message.toString());
                    });
                }
            } else {
                // Message is FROM a client (phone) -> Relay to host
                const playerIndex = room.clients.findIndex(c => c === ws);
                data.playerIndex = playerIndex; // Add playerIndex to every message from client
                room.host.send(JSON.stringify(data));
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

function generateRoomCode() { /* ... unchanged ... */ }
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

