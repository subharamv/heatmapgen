function init(io) {
  io.on("connection", (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });

    socket.on("subscribe_zone", (zoneId) => {
      socket.join(`zone:${zoneId}`);
    });
  });
}

module.exports = { init };
