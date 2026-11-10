const Service = require('node-windows').Service;
const path = require('path');

// Create a new Service object
const svc = new Service({
  name: 'VRS Office Radio',
  description: 'VRS Office Radio - Web Music Request and Player Background Service',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: []
});

// Listen for the "install" event, which indicates the process is available as a service.
svc.on('install', function () {
  console.log('[Windows Service] VRS Office Radio Service Installed Successfully!');
  svc.start();
  console.log('[Windows Service] Service Started Automatically in Background.');
});

svc.on('alreadyinstalled', function () {
  console.log('[Windows Service] Service is already installed.');
});

svc.install();
