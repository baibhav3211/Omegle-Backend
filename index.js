const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // enable CORS if your front end is on a different port

// We create an HTTP server using Express:
const server = http.createServer(app);

// Attach socket.io to the server
const io = new Server(server, {
  cors: {
    origin: "*", // in production, restrict this to your client domain
    methods: ["GET", "POST"]
  }
});

// This array will store sockets that are waiting for a partner
let waitingQueue = [];

// A helper to match two users and let them chat in a private room
// A helper to match two users and let them chat in a private room
const matchTwoUsers = (socket1, socket2) => {
  // We'll create a private "room" for these two
  const roomId = `${socket1.id}#${socket2.id}`;
  socket1.join(roomId);
  socket2.join(roomId);

  // Let each socket know they are now paired
  socket1.emit('matched', { partnerId: socket2.id, partnerCountry: socket2.userData.country });
  socket2.emit('matched', { partnerId: socket1.id, partnerCountry: socket1.userData.country });

  // We’ll store the partner’s ID in a socket property for convenience
  socket1.partnerId = socket2.id;
  socket2.partnerId = socket1.id;

  // Let them know the room so they can send messages to each other
  socket1.currentRoom = roomId;
  socket2.currentRoom = roomId;
};


// Handle connections
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // New: Store user preferences
  socket.userData = { country: null, ageConsent: false };

  // When a user indicates "I want to find a partner", we put them in the queue
  socket.on('findPartner', ({ country, ageConsent }) => {
    if (!ageConsent) return; // If age consent is not true, don't allow to proceed
    
    // Save the user's country and age consent status
    socket.userData.country = country;
    socket.userData.ageConsent = ageConsent;

    console.log(`User ${socket.id} is searching from ${country} with age consent: ${ageConsent}`);
    console.log("Current Waiting Queue:", waitingQueue.map(s => ({ id: s.id, country: s.userData.country, ageConsent: s.userData.ageConsent })));

    // If someone is waiting in the queue, try to match them
    const compatibleSocketIndex = waitingQueue.findIndex(s => s.userData.ageConsent);

    if (compatibleSocketIndex !== -1) {
      const waitingSocket = waitingQueue.splice(compatibleSocketIndex, 1)[0];
      matchTwoUsers(waitingSocket, socket);
    } else {
      // Otherwise, add this one to the waiting queue
      waitingQueue.push(socket);
    }
});


  // When a user sends a chat message
  socket.on('chatMessage', (msg) => {
    // If this user has a current room, broadcast the message to that room
    if (socket.currentRoom) {
      io.to(socket.currentRoom).emit('chatMessage', {
        sender: socket.id,
        message: msg
      });
    }
  });

  // When the user disconnects or wants to “quit chat”
  const handleDisconnect = () => {
    console.log(`Client disconnected or left chat: ${socket.id}`);

    // Remove from waiting queue if present
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    // Let the partner know
    if (socket.partnerId) {
      const partnerSocket = io.sockets.sockets.get(socket.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partnerLeft');
        // If partner is still connected, we can put them back in queue
        partnerSocket.partnerId = null;
        partnerSocket.currentRoom = null;

        // Push the partner back into the queue if they are still connected
        if (partnerSocket.connected) {
          waitingQueue.push(partnerSocket);
        }
      }
    }
  };

  // On manual "leaveChat" event:
  socket.on('leaveChat', handleDisconnect);

  // On browser disconnect:
  socket.on('disconnect', handleDisconnect);
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
