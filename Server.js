const express = require('express');
const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect().catch(console.error);
const redisStore = new RedisStore({ client: redisClient });

app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(bodyParser.json());
app.use(cors({ origin: true, credentials: true }));

const users = [{ username: 'Admin_appel420', passwordHash: bcrypt.hashSync('Ustream4free2025!', 10) }];
const streamKeys = {};
const streamerVisits = {};
let globalVisitorCount = 0;

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// Visitor tracking middleware
app.use((req,res,next)=>{
  if(!req.path.startsWith('/api') && !req.path.startsWith('/stream-keys') && !req.path.startsWith('/analytics')){
    globalVisitorCount++;
    const username=req.session.user;
    if(username){
      if(!streamerVisits[username]) streamerVisits[username]=0;
      streamerVisits[username]++;
      io.to(username).emit('visitor-count-update',{visitors:streamerVisits[username]});
    }
    io.to('admin').emit('visitor-count-update',{visitors:globalVisitorCount});
  }
  next();
});

app.post('/login', async (req,res)=>{
  const {username,password}=req.body;
  const user = users.find(u => u.username===username);
  if(!user) return res.status(401).json({error:'Invalid credentials'});
  const valid = await bcrypt.compare(password,user.passwordHash);
  if(!valid) return res.status(401).json({error:'Invalid credentials'});
  req.session.user = username;
  res.json({status:'ok',user:username});
});

app.post('/stream-keys',(req,res)=>{
  const username=req.session.user;
  if(!username) return res.status(401).json({error:'Not logged in'});
  const {key}=req.body;
  const hash=crypto.createHash('sha3-512').update(key).digest('hex');
  if(!streamKeys[username]) streamKeys[username]=[];
  streamKeys[username].push(hash);
  io.to(username).emit('stream-keys-update',{keys:streamKeys[username]});
  res.json({status:'ok',hashedKey:hash});
});

app.get('/stream-keys',(req,res)=>{
  const username=req.session.user;
  if(!username) return res.status(401).json({error:'Not logged in'});
  res.json({keys:streamKeys[username]||[]});
});

app.delete('/stream-keys',(req,res)=>{
  const username=req.session.user;
  if(!username) return res.status(401).json({error:'Not logged in'});
  streamKeys[username]=[];
  io.to(username).emit('stream-keys-update',{keys:[]});
  res.json({status:'deleted'});
});

app.delete('/analytics',(req,res)=>{
  const username=req.session.user;
  if(!username) return res.status(401).json({error:'Not logged in'});
  if(username==='Admin_appel420'){
    globalVisitorCount=0;
    io.to('admin').emit('visitor-count-update',{visitors:globalVisitorCount});
  } else {
    streamerVisits[username]=0;
    io.to(username).emit('visitor-count-update',{visitors:0});
  }
  res.json({status:'reset'});
});

io.on('connection', socket=>{
  const username=socket.handshake.auth?.username;
  if(username==='Admin_appel420'){
    socket.join('admin');
    socket.emit('visitor-count-update',{visitors:globalVisitorCount});
  } else if(username){
    socket.join(username);
    socket.emit('visitor-count-update',{visitors:streamerVisits[username]||0});
    socket.emit('stream-keys-update',{keys:streamKeys[username]||[]});
  }
  socket.on('request-stream-keys',username=>{
    socket.emit('stream-keys-update',{keys:streamKeys[username]||[]});
  });
  socket.on('disconnect',()=>console.log('Client disconnected'));
});

server.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));

