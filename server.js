// --- Spellbound Relay Server ---
// This is our Node.js "post office" application.

// Import the WebSocket library
const WebSocket = require('ws');

// Create a WebSocket server. We'll run it on port 8080.
const wss = new WebSocket.Server({ port: 8080 });

// This Map will store all our game rooms.
// Key: "ABCD" (room code)
// Value: { host: WebSocket, clients: [WebSocket, ...] }
const rooms = new Map();

console.log('Spellbound Relay Server is running on port 8080...');

// This function runs every time a new user (Godot or a phone) connects.
wss.on('connection', ws => {
    console.log('A new client connected.');

    // This function runs when the server receives a message from this client.
    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            // --- Handle specific message types ---

            if (data.type === 'create_room') {
                // This message comes from the Godot game (the host)
                const roomCode = generateRoomCode();
                ws.roomCode = roomCode; // Store the code on the host's connection
                rooms.set(roomCode, {
                    host: ws,
                    clients: []
                });
                console.log(`Room ${roomCode} created by host.`);
                
                // Send the new code back to the Godot host
                ws.send(JSON.stringify({ type: 'room_created', code: roomCode }));
            }
            else if (data.type === 'join_room') {
                // This message comes from a player's phone
                const room = rooms.get(data.code.toUpperCase());
                
                if (room) {
                    // Room exists, add this player to it
                    ws.roomCode = data.code.toUpperCase();
                    ws.playerName = data.name;
                    room.clients.push(ws);
                    console.log(`Player ${data.name} joined room ${ws.roomCode}.`);
                    
                    // Tell the host (Godot) that a new player has joined
                    room.host.send(JSON.stringify({
                        type: 'player_joined',
                        name: data.name,
                        picture: data.picture // We just pass the Base64 data through
                    }));
                } else {
                    // Room not found, send an error back to the phone
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
                }
            }
            else {
                // This is a generic relay message (like "buzz", "start_game", "next_turn")
                const room = rooms.get(ws.roomCode);
                if (!room) return;

                if (room.host === ws) {
                    // Message is FROM the host (Godot)
                    // Relay it to ALL clients (phones) in that room
                    room.clients.forEach(client => {
                        client.send(message.toString());
                    });
                } else {
                    // Message is FROM a client (phone)
                    // Relay it ONLY to the host (Godot)
                    room.host.send(message.toString());
                }
            }

        } catch (error) {
            console.error('Failed to parse message or handle logic:', error);
        }
    });

    // This function runs when a client disconnects
    ws.on('close', () => {
        console.log('A client disconnected.');
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        if (room.host === ws) {
            // The host (Godot) disconnected!
            // Tell all clients to disconnect and delete the room
            room.clients.forEach(client => {
                client.send(JSON.stringify({ type: 'room_closed' }));
                client.close();
            });
            rooms.delete(ws.roomCode);
            console.log(`Room ${ws.roomCode} has been closed.`);
        } else {
            // A player (phone) disconnected
            // Remove them from the clients list
            room.clients = room.clients.filter(client => client !== ws);
            
            // Tell the host (Godot) that the player left
            room.host.send(JSON.stringify({
                type: 'player_left',
                name: ws.playerName
            }));
            console.log(`Player ${ws.playerName} left room ${ws.roomCode}.`);
        }
    });
});

// Helper function to create a random 4-letter code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code)); // Ensure code is unique
    return code;
}
