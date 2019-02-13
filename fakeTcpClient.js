const repl = require('repl');
var net = require('net');
var client = new net.Socket();

const r = repl.start('> ');
r.context.client = client;

client.connect(8080, '127.0.0.1', function() {
  console.log('Connected to TCP Server!');
});

client.on('data', (data) => {
  console.log('Received: ' + data);
});

client.on('close', () => {
  console.log('Connection closed.');
  setTimeout(() => {
    client.connect(8080, '127.0.0.1', function() {
      console.log('Connected to TCP Server!');
    });
  }, 1500);
});
