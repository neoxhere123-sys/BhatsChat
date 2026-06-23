const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('connected');
  socket.emit('join', { username: 'TestUser', pfp: null });

  setTimeout(() => {
    console.log('Sending /aloo 5');
    socket.emit('message', '/aloo 5');
  }, 500);

  setTimeout(() => {
    console.log('Sending /wow');
    socket.emit('message', '/wow');
  }, 1500);

  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 3000);
});

socket.on('message', (data) => {
  console.log('RECEIVED:', data);
});

socket.on('disconnect', () => {
  console.log('disconnected');
});
