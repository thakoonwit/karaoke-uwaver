const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('normal player broadcasts never load audio extractors and the legacy proxy is disabled by default', async () => {
  const routes = new Map();
  const required = [];
  let broadcasts = 0;
  const app = { use() {}, post: (url, ...handlers) => routes.set(url, handlers), get: (url, handler) => routes.set(url, [handler]) };
  const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
  class Server { to() { return this; } on() {} emit() { broadcasts++; } }
  vm.runInNewContext(source('server.js') + '\nfor(let i=0;i<10000;i++)broadcastState();', {
    __dirname: root, URL, process: { env: {} }, console: quiet,
    require: name => {
      required.push(name);
      if (['./audio','yt-dlp-exec','ffmpeg-static'].includes(name)) throw Error('Unnecessary audio load');
      return ({ dotenv: { config() {} }, express, 'socket.io': { Server },
        http: { createServer: () => ({ listen() {} }) }, os: { networkInterfaces: () => ({}) }, qrcode: {},
        './rooms': require('../rooms'), './queue': { getState: () => ({ queue: [{videoId:'abcdefghijk'}] }) }, './youtube': {} })[name] || require(name);
    }
  });
  assert.equal(broadcasts, 10000);
  let status;
  await routes.get('/api/stream/:videoId')[0]({params:{videoId:'abcdefghijk'}}, { status(code) {status=code;return this;}, json() {} });
  assert.equal(status, 503);
  assert.ok(!required.includes('./audio'));
});

test('search concurrency is bounded and slots recover after failure and invalid input', async () => {
  const routes = new Map(), pending = [];
  const app = { use() {}, post: (url, ...handlers) => routes.set(url, handlers), get() {} };
  const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
  class Server { to() { return this; } on() {} }
  vm.runInNewContext(source('server.js'), {
    __dirname: root, URL, process: { env: {} }, console: quiet,
    require: name => ({dotenv:{config(){}},express,'socket.io':{Server},http:{createServer:()=>({listen(){}})},
      os:{networkInterfaces:()=>({})},qrcode:{},'./rooms': require('../rooms'), './queue':{},
      './youtube':{searchVideos:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}})[name] || require(name)
  });
  const response = () => ({ code:200, headers:{}, status(code){this.code=code;return this;}, json(data){this.data=data;},setHeader(key,value){this.headers[key]=value;} });
  const search = routes.get('/api/search')[0];
  const a=response(),b=response(),c=response();
  const first=search({body:{query:'one'}},a),second=search({body:{query:'two'}},b);
  await search({body:{query:'three'}},c);
  assert.equal(pending.length,2);
  assert.equal(c.code,503);
  assert.equal(c.headers['Retry-After'],'3');
  pending[0].reject(Error('upstream failed'));pending[1].resolve({results:[]});
  await Promise.all([first,second]);
  assert.equal(a.code,400);assert.equal(b.code,200);
  for(const query of [null,{},'x'.repeat(501),'']) {
    const res=response();await search({body:{query}},res);assert.equal(res.code,400);
  }
  const res=response();const again=search({body:{query:'valid'}},res);
  assert.equal(pending.length,3);pending[2].resolve({results:[]});await again;
  assert.equal(res.data.success,true);
});

test('search cache evicts old entries and expires them; HTTP response size/time are limited', () => {
  let time=10000,options;
  class Clock extends Date { static now(){return time;} }
  const module={exports:{}};
  vm.runInNewContext(source('youtube.js')+'\nmodule.exports.inspect={cache:searchCache,put:cacheSearch};', {
    module, console:quiet, Date:Clock,
    require:name=>name==='axios'?{create(config){options=config;return {};}}:require(name)
  });
  const {cache,put}=module.exports.inspect;
  for(let i=0;i<1000;i++)put('search '+i,{results:[{title:'sample'}]});
  assert.equal(cache.size,100);
  assert.equal(cache.has('search 0'),false);
  assert.equal(cache.has('search 999'),true);
  time+=3600001;put('fresh',{results:[]});
  assert.equal(cache.size,1);
  assert.equal(options.timeout,15000);
  assert.equal(options.maxContentLength,8*1024*1024);
});

test('optional audio uses one process, coalesces duplicate requests and releases failed work', async () => {
  let calls=0,finish,opts;
  let extractor=()=>new Promise(resolve=>{finish=resolve;});
  const module={exports:{}};
  vm.runInNewContext(source('audio.js')+'\nmodule.exports.cache=streamUrlCache;', {
    module,console:quiet,require:name=>{
      if(name==='ffmpeg-static')throw Error('FFmpeg should not be loaded for URL extraction');
      if(name==='yt-dlp-exec')return (url,flags,options)=>{calls++;opts=options;return extractor(url);};
      return require(name);
    }
  });
  const audio=module.exports;
  const first=audio.getAudioStreamUrl('abcdefghijk');
  const same=audio.getAudioStreamUrl('abcdefghijk');
  assert.equal(first,same);
  await assert.rejects(audio.getAudioStreamUrl('lmnopqrstuv'),err=>err.statusCode===503);
  assert.equal(calls,1);
  finish('https://example.test/audio');await first;
  assert.equal(await audio.getAudioStreamUrl('abcdefghijk'),'https://example.test/audio');
  assert.equal(calls,1);
  assert.equal(opts.timeout,20000);assert.equal(opts.maxBuffer,65536);assert.equal(opts.killSignal,'SIGKILL');
  extractor=()=>Promise.reject(Object.assign(Error('timeout'),{timedOut:true}));
  await assert.rejects(audio.getAudioStreamUrl('lmnopqrstuv'));
  assert.equal(calls,2); // No second extraction after hitting the timeout.
  extractor=()=>Promise.reject(Object.assign(Error('blocked'),{stderr:'Sign in to confirm you are not a bot'}));
  await assert.rejects(audio.getAudioStreamUrl('lmnopqrstuv'));
  assert.equal(calls,3); // A permanent YouTube refusal must not trigger the fallback process.
  extractor=()=>Promise.resolve('https://example.test/audio');
  for(let i=0;i<50;i++)await audio.getAudioStreamUrl(String(i).padStart(11,'0'));
  assert.equal(audio.cache.size,32);
});

test('playback history and expired device cooldowns do not accumulate in RAM', () => {
  const now=Date.now();
  const item=i=>({id:String(i),videoId:'abcdefghijk',requestedAt:now});
  let saved=JSON.stringify({history:Array.from({length:2000},(_,i)=>item(i)),
    lastRequestByDevice:{old:now-86400001,recent:now-1000}});
  const module={exports:{}};
  vm.runInNewContext(source('queue.js'), {
    module,__dirname:root,process:{env:{}},console:quiet,
    require:name=>name==='fs'?{existsSync:()=>true,readFileSync:()=>saved,writeFileSync:(file,data)=>{saved=data;}}:require(name)
  });
  const queue=module.exports;
  assert.equal(queue.history.length,200);
  queue.history.push(...Array.from({length:1000},(_,i)=>item(i+2000)));queue.save();
  assert.equal(queue.history.length,200);
  assert.equal(queue.lastRequestByDevice.old,undefined);
  assert.equal(queue.lastRequestByDevice.recent,now-1000);
  assert.equal(JSON.parse(saved).history.length,200);
});
