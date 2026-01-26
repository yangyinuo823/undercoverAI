// Room and Player types
export interface Player {
  id: string;          // Socket ID
  name: string;
  isReady: boolean;
}

export interface Room {
  code: string;
  players: Map<string, Player>;  // socketId -> Player
  hostId: string;
  createdAt: Date;
  maxPlayers: number;
}

// Generate a random 6-character room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars like 0, O, 1, I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

class RoomManager {
  private rooms: Map<string, Room> = new Map(); // roomCode -> Room
  private playerToRoom: Map<string, string> = new Map(); // socketId -> roomCode

  // Create a new room
  createRoom(hostSocketId: string, hostName: string): Room {
    let code = generateRoomCode();
    
    // Ensure unique code
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }

    const room: Room = {
      code,
      players: new Map(),
      hostId: hostSocketId,
      createdAt: new Date(),
      maxPlayers: 3, // 3 human players (AI is Player_4)
    };

    // Add host as first player
    room.players.set(hostSocketId, {
      id: hostSocketId,
      name: hostName,
      isReady: false,
    });

    this.rooms.set(code, room);
    this.playerToRoom.set(hostSocketId, code);

    console.log(`Room created: ${code} by ${hostName}`);
    return room;
  }

  // Join an existing room
  joinRoom(roomCode: string, socketId: string, playerName: string): { success: boolean; room?: Room; error?: string } {
    const room = this.rooms.get(roomCode.toUpperCase());

    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    if (room.players.size >= room.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

    if (room.players.has(socketId)) {
      return { success: false, error: 'Already in this room' };
    }

    // Check for duplicate names
    const existingNames = Array.from(room.players.values()).map(p => p.name.toLowerCase());
    if (existingNames.includes(playerName.toLowerCase())) {
      return { success: false, error: 'Name already taken in this room' };
    }

    // Add player to room
    room.players.set(socketId, {
      id: socketId,
      name: playerName,
      isReady: false,
    });

    this.playerToRoom.set(socketId, roomCode.toUpperCase());

    console.log(`${playerName} joined room: ${roomCode}`);
    return { success: true, room };
  }

  // Get room by code
  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  // Get room that a player is in
  getRoomByPlayerId(socketId: string): Room | undefined {
    const roomCode = this.playerToRoom.get(socketId);
    if (roomCode) {
      return this.rooms.get(roomCode);
    }
    return undefined;
  }

  // Remove player from their room
  removePlayer(socketId: string): { room?: Room; wasHost: boolean } {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) {
      return { wasHost: false };
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.playerToRoom.delete(socketId);
      return { wasHost: false };
    }

    const wasHost = room.hostId === socketId;
    room.players.delete(socketId);
    this.playerToRoom.delete(socketId);

    console.log(`Player ${socketId} left room: ${roomCode}`);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
      console.log(`Room ${roomCode} deleted (empty)`);
      return { wasHost };
    }

    // If host left, assign new host
    if (wasHost && room.players.size > 0) {
      const newHostId = room.players.keys().next().value;
      if (newHostId) {
        room.hostId = newHostId;
        console.log(`New host for room ${roomCode}: ${newHostId}`);
      }
    }

    return { room, wasHost };
  }

  // Get number of players needed to start
  getPlayersNeeded(roomCode: string): number {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return 0;
    return room.maxPlayers - room.players.size;
  }

  // Get all players in a room as an array
  getPlayersInRoom(roomCode: string): Player[] {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return [];
    return Array.from(room.players.values());
  }

  // Check if room is full (ready to start)
  isRoomFull(roomCode: string): boolean {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return false;
    return room.players.size >= room.maxPlayers;
  }
}

// Export singleton instance
export const roomManager = new RoomManager();
