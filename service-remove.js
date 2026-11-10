const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'VRS Office Radio',
  script: path.join(__dirname, 'server.js')
});

svc.on('uninstall', function () {
  console.log('[Windows Service] VRS Office Radio Service Uninstalled Successfully.');
});

svc.uninstall();
