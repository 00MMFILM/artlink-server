// Local-only preview. Never calls Supabase or an AI provider.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../public');
// These handlers degrade gracefully without environment values. Keep preview offline.
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
const app = require('../api/app.js');
const practice = require('../api/practice.js');
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname === '/app') return app(req,res);
  if(url.pathname === '/practice') return practice(req,res);
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if(!file.startsWith(root + path.sep) && file !== root) {res.statusCode=403;return res.end();}
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
  if(!fs.existsSync(file)) {res.statusCode=404;return res.end('Not found');}
  res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.PORT || 4178),'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:' + server.address().port + '/launch/'));
