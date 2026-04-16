const WebSocket = require('ws');
const ws = new WebSocket('ws://193.136.62.78:8006/ws/logs');
ws.on('open', () => { console.log('connected'); setTimeout(() => ws.close(), 5000) });
ws.on('message', (msg) => console.log('MSG:', msg.toString()));
ws.on('error', console.error);
