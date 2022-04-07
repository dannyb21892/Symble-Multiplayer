'use strict';

const express = require('express');
const socketIO = require('socket.io');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const io = socketIO(server, {
  cors: {
    origin: "https://www.symble.app",//"*",//"http://localhost:4200",//
    methods: ["GET", "POST"]
  }
});

const openGames = {};

const messageSafeGameState = (game) => {
  const out = {};
  Object.keys(game.players).forEach(k => {
    out[k] = {
      ...game.players[k],
      socket: null
    }
  });
  return out;
}

io.on('connection', (socket) => {
  socket.on('join-room', (roomKey) => prepareGame(socket, roomKey))

  socket.emit('connected');

  socket.on("disconnecting", () => {
    const currentRoom = Array.from(socket.rooms).find(r => r !== socket.id);
    if(currentRoom){
      const opponent = Object.entries(openGames[currentRoom].players).find(([id, opponent]) => socket.id !== id);
      if(opponent){
        opponent[1].socket.emit('opponent-disconnected', {game: messageSafeGameState(openGames[currentRoom]), player: opponent[1].socket.id, outcome: 'You win! Your opponent disconnected!'});
      }
    }
    io.in(currentRoom).socketsLeave(currentRoom);
    delete openGames[currentRoom];
  });
});

const prepareGame = (socket, roomKey = '') => {
  if(roomKey){//custom room name
    roomKey = "custom_" + roomKey;
    let existing = openGames[roomKey];
    if(!existing){
      let newRoom = {
        players: {}
      };
      newRoom.players[socket.id] = {score: 0, guesses: 0, avgGuesses: 0, socket: socket};
      openGames[roomKey] = newRoom;
      socket.join(roomKey);
      io.to(roomKey).emit('waiting-for-opponent', roomKey)
    }
    else if(existing && Object.keys(existing.players).length === 1){
      existing.players[socket.id] = {score: 0, guesses: 0, avgGuesses: 0, socket: socket};
      socket.join(roomKey);
      io.to(roomKey).emit('opponent-found', roomKey)
      manageGame(roomKey)
    }
    else if(existing && Object.keys(existing.players).length > 1){
      socket.emit('room-full', roomKey);
      socket.disconnect();
    }
  }
  else {//random opponent
    const openRoom = Object.entries(openGames).find(([roomId, gameInfo]) => !roomId.includes("custom") && Object.keys(gameInfo.players).length === 1);
    let roomName;
    if(!openRoom){
      roomName = new Date().valueOf().toString()
      openGames[roomName] = {
        players: {}
      };
      openGames[roomName].players[socket.id] = {score: 0, guesses: 0, avgGuesses: 0, socket: socket};
      socket.join(roomName);
      io.to(roomName).emit('waiting-for-opponent', roomName)
    }
    else {
      roomName = openRoom[0];
      openGames[roomName].players[socket.id] = {score: 0, guesses: 0, avgGuesses: 0, socket: socket};
      socket.join(roomName);
      io.to(roomName).emit('opponent-found', roomName)
      manageGame(roomName)
    }
  }
}

const manageGame = (room) => {
  const game = openGames[room];
  const players = Object.keys(game.players);
  const p1 = game.players[players[0]];
  const p2 = game.players[players[1]];
  const answerList = [];
  for(let i = 0; i < 50; i++){
    let answer = Math.floor(Math.random() * 2311);
    while(answerList.includes(answer)){
      answer = Math.floor(Math.random() * 2311);
    }
    answerList.push(answer);
  }
  io.to(room).emit('answers', answerList);
  setTimeout(() => {//3 second delay after finding an opponent before start
    io.to(room).emit('start', answerList[0])
    setTimeout(() => {//5 minute timer determines when the game ends
      let winner;
      let loser;
      if(p2.score > p1.score || (p2.score === p1.score && p2.avgGuesses < p1.avgGuesses)){
        winner = p2;
        loser = p1;
      }
      else if(p2.score < p1.score || (p2.score === p1.score && p2.avgGuesses > p1.avgGuesses)){
        winner = p1;
        loser = p2;
      }

      if(winner){
        winner.socket.emit('win', {game: messageSafeGameState(game), player: winner.socket.id, outcome: `Time's up! You won!`});
        loser.socket.emit('lose', {game: messageSafeGameState(game), player: loser.socket.id, outcome: "Time's up! You lost!"});
      }
      else {
        console.log(messageSafeGameState(game))
        p1.socket.emit('tie', {game: messageSafeGameState(game), player: p1.socket.id, outcome: "Time's up! Amazing, an exact tie!"});
        p2.socket.emit('tie', {game: messageSafeGameState(game), player: p2.socket.id, outcome: "Time's up! Amazing, an exact tie!"});
      }
    }, 300000);
  }, 3000);

  p1.socket.on('guess', (guess) => {
    p1.guesses += 1;
    if(guess === answerList[p1.score]){
      p1.avgGuesses = ((p1.avgGuesses * p1.score) + p1.guesses) / ++p1.score;
      p1.guesses = 0;
      p1.socket.emit('correct', {game: messageSafeGameState(game), player: p1.socket.id, answer: answerList[p1.score]});
      p2.socket.emit('opponent-correct', {game: messageSafeGameState(game), player: p1.socket.id});
    }
    else if(p1.guesses >= 8){
      p1.socket.emit('lose', {game: messageSafeGameState(game), player: p1.socket.id, outcome: 'You lost! You ran out of guesses!'});
      p2.socket.emit('win', {game: messageSafeGameState(game), player: p2.socket.id, outcome: 'You win! Your opponent ran out of guesses!'});
      p1.socket.disconnect();
      p2.socket.disconnect();
    }
    else {
      p1.socket.emit('incorrect', {game: messageSafeGameState(game), player: p1.socket.id});
    }
  });

  p2.socket.on('guess', (guess) => {
    p2.guesses += 1;
    if(guess === answerList[p2.score]){
      p2.avgGuesses = ((p2.avgGuesses * p2.score) + p2.guesses) / ++p2.score;
      p2.guesses = 0;
      p2.socket.emit('correct', {game: messageSafeGameState(game), player: p2.socket.id, answer: answerList[p2.score]});
      p1.socket.emit('opponent-correct', {game: messageSafeGameState(game), player: p2.socket.id});
    }
    else if(p2.guesses >= 8){
      p2.socket.emit('lose', {game: messageSafeGameState(game), player: p2.socket.id, outcome: 'You lost! You ran out of guesses!'});
      p1.socket.emit('win', {game: messageSafeGameState(game), player: p1.socket.id, outcome: 'You win! Your opponent ran out of guesses!'});
      p2.socket.disconnect();
      p1.socket.disconnect();
    }
    else {
      p2.socket.emit('incorrect', {game: messageSafeGameState(game), player: p2.socket.id});
    }
  });

  p1.socket.on('give-up', () => {
    p1.socket.emit('lose', {game: messageSafeGameState(game), player: p1.socket.id, outcome: 'You lost! You gave up!'});
    p2.socket.emit('win', {game: messageSafeGameState(game), player: p2.socket.id, outcome: 'You win! Your opponent gave up!'});
  })

  p2.socket.on('give-up', () => {
    p2.socket.emit('lose', {game: messageSafeGameState(game), player: p2.socket.id, outcome: 'You lost! You gave up!'});
    p1.socket.emit('win', {game: messageSafeGameState(game), player: p1.socket.id, outcome: 'You win! Your opponent gave up!'});
  })
}
