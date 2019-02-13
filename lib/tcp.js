var net = require('net');
// var mdns = require('mdns');

const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

var clients = [];
var server = net.createServer(function(socket) {
  socket.name = socket.remoteAddress + ":" + socket.remotePort;
  clients.push(socket);

  console.log('Client connected from ' + socket.name);

  socket.on('data', (data) => {
    console.log('Received : ' + data);
    myEmitter.emit('data', data);
  });

  socket.on('close', () => {
    console.log('Connection ' + socket.name + ' closed');
    clients.splice(clients.indexOf(socket), 1);
  });

  socket.on('end', () => {
    console.log('Connection ' + socket.name + ' ended');
    clients.splice(clients.indexOf(socket), 1);
  });
});

server.listen(8080, '0.0.0.0', () => {
  console.log("TCP Server listened on port: 8080");
});


function sendToClients(data) {
  if (!clients) return console.error('Error while sending client data because there is no client connected: ', data);
  
  clients.forEach(function (client) {
    client.write(data, () => {
      console.log("Sent to client: ", client.name, data);
    });
  });
}

module.exports = {
  send: data => sendToClients(data),
  addListener: fn => myEmitter.addListener('data', fn),
  removeListener: fn => myEmitter.removeListener('data', fn),
};
