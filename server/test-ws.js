const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/');
ws.on('open', function open() {
  console.log('connected');
  setTimeout(() => process.exit(0), 1000);
});
