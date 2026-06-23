const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('connected');
  socket.emit('join', { username: 'ImageTester', pfp: null });

  setTimeout(() => {
    console.log('typing...');
    socket.emit('typing');
  }, 500);

  setTimeout(() => {
    console.log('stop typing');
    socket.emit('stopTyping');
  }, 1500);

  setTimeout(() => {
    const imagePath = path.join(__dirname, 'public', 'Untitled.jpg');
    if (!fs.existsSync(imagePath)) {
      console.log('image file missing:', imagePath);
      socket.close();
      process.exit(1);
    }
    const image = fs.readFileSync(imagePath, { encoding: 'base64' });
    const dataUrl = `data:image/jpeg;base64,${image}`;
    console.log('sending image');
    socket.emit('image', { image: dataUrl });
  }, 2200);

  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 3200);
});

socket.on('message', (data) => {
  console.log('RECEIVED:', data);
});

socket.on('typing', (data) => {
  console.log('TYPING EVENT:', data);
});

socket.on('stopTyping', (data) => {
  console.log('STOP TYPING EVENT:', data);
});

socket.on('disconnect', () => {
  console.log('disconnected');
});
