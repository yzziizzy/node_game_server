



var engine = require('engine.io');
var server = engine.listen(8924);

/*

Client          Server
   -hello(gameid, pass)->
   <-youAre(playerid)-
         -or-
   -login(gameid, playerid, pass)->
   <-youAre(playerid)-

   -newGame(gamename)->
   <-initgame(gameid)-
   <-master(playerid)-
   
   -startGame->
   <-startGame-
   
   -joinGame(gameid)->
   <-joined(bool:success)-
   
   <-startTurn(playerid)-
   <-pm(otherplayerid)->
   
   -move->

   -endTurn->
   <-endedTurn(playerid)-
   
   =cheated(playerid)=>
   <-disqualified(playerid)- // master should decide what happens?
   
   =playerwon(playerid)=>
   <-won(playerid)-
   <-lost(playerid)-
*/


var Games = {};
var SocketStates = {};





function Game(creator) {
	this.id = next_game_id++;
	this.players = [creator];
	this.master = creator;
	
	this.maxPlayers = 0;
	this.lockOnStart = true;
	this.canChangeSettingsAfterStart = false;
	this.skipAwayPlayers = false;
	
	this.turnNumber = 0;
	this.state = "init";
	this.currentPlayer = null;
	
	this.settingsBlob = "{}";
	this.dataBlob = "{}";
	
	Games[this.id] = this;
	
	this.join(creator);
}

Game.prototype.join = function(player) {
	if(-1 !== this.players.indexOf(player)) 
		return "You are already playing";

	if(this.maxPlayers && this.maxPlayers >= this.players.length) 
		return "Maximum players reached";
	
	if(this.lockOnStart && this.state != "init") 
		return "You cannot join after the game has started";
	
	this.players.push(player);
	
	this.broadcast("joined", player);
	return true;
}



Game.prototype.start = function() {
	this.state = "playing";
	this.broadcast("gameStarted");
	
	this.currentPlayer = this.players[this.players.length-1];
	this.nextTurn();
}
Game.prototype.nextTurn = function() {
	
	var i = this.players.indexOf(this.currentPlayer);
	
	// move to next player
	i++;
	if(i == this.players.length-1) i = 0;
	var p = this.players[i];
	
	this.currentPlayer = p;

	this.broadcast("startTurn", p); 
}

Game.prototype.endTurn = function(player) {
	if(player != this.currentPlayer)
		return "It is not that player's turn";
	
	this.broadcast("turnEnded", player); 
	
	this.nextTurn();
}

Game.prototype.broadcast = function(verb, data) {
	var len = this.players.length;
	for(var i = 0; i < len; i++) {
		this.players[i].sendMessage(verb, data);
	}
}


Game.prototype.pm = function(to, verb, data) {
	if(-1 === this.players.indexOf(to)) 
		return "Recipient is not in the game";
	
	SocketStates[to].sendMessage(verb, data);
}




function SocketState(sock) {
	this.id = next_connection_id++;
	this.sock = sock;
	
	this.game = null;
	
	SocketStates[this.id] = this;

	sock.send(JSON.stringify({
		ordinal: next_message_ordinal++,
		name: 'youAre',
		data: this.id,
	}));
	
	sock.on('message', SocketState.prototype.onMessage.bind(this));
	sock.on('close', SocketState.prototype.onClose.bind(this));
		
		
	
	
}

SocketState.prototype.sendMessage = function(verb, data) {
	this.sock.send(JSON.stringify({
		ordinal: next_message_ordinal++,
		name: verb,
		data: data,
	}));
}

function jsonParse(x) {
	try {
		var y = JSON.parse(x);
	}
	catch(e) {
		return undefined;
	}
	return y;
}

var kosherVerbs = {
	newGame: true,
	joinGame: true,
	startGame: true,
	endTurn: true,
	move: true,
	won: true,
	roll: true,
	shuffle: true,
	userBroadcast: true,
	userPM: true,
};
var nonPlayingVerbs = {
	newGame: true,
	joinGame: true,
};
SocketState.prototype.onMessage = function(e) {
	console.log("new message:", e);
	
	var msg = jsonParse(e);
	if(msg === undefined) {
		return this.sendMessage("error", "Invalid request format");
	}
	
	if(!kosherVerbs[msg.name]) {
		console.log("invalid verb", msg);
		return;
	}
	
	if(!nonPlayingVerbs[msg.name] && this.game == null) {
		return this.sendMessage("error", "You are not currently in a game");
	}
	
	// TODO: check ordinal
	
	this["rcv_" + msg.name](msg.data);
	
}



SocketState.prototype.onClose = function(e) {
	console.log("connection closed:", this.id, e);
	
	delete SocketStates[this.id];
}

SocketState.prototype.rcv_joinGame = function(msg) {
	var g = Games[msg.data];
	if(!g) {
		return this.sendMessage("error", "Game not found");
	}
	
	var rep = g.join(this.id);
	if(true === rep) {
		this.game = Games[msg.data]
		return;
	}
	
	this.sendMessage("error", rep);
}
SocketState.prototype.rcv_newGame = function(msg) {
	var g = new Game(this.id);
	this.game = g;
	this.sendMessage("gameCreated", g.id);
	this.sendMessage("promoted", this.id);
}
SocketState.prototype.rcv_startGame = function(msg) {
	this.game.start();
}


SocketState.prototype.rcv_endTurn = function(msg) {
	var res = this.game.endTurn(this.id);
	if(res === true) return;
	
	this.sendMessage("error", res);
}
SocketState.prototype.rcv_move = function(msg) {
// 	var g = new Game(this.id);
// 	this.sendMessage("gameCreated", g.id);
}
SocketState.prototype.rcv_won = function(msg) {
// 	var g = new Game(this.id);
// 	this.sendMessage("gameCreated", g.id);
}

SocketState.prototype.rcv_shuffle = function(msg) {
	var n = msg|0;
	
	var arr = new Array(n);
	for(var i = 0; i < n; i++) arr[i] = i;
	
	this.game.broadcast('shuffled', {
		who: this.id,
		results: _.shuffle(arr),
	});
}

SocketState.prototype.rcv_roll = function(msg) {
	var dice = msg.split('d');
	var n = dice[0]|0;
	var sides = dice[1]|0;
	
	var vals = [];
	for(var i = 0; i < n; i++) {
		vals.push((Math.random() * sides)|0);
	}
	
	this.game.broadcast("rolled", {
		who: this.id,
		dice: msg,
		results: vals,
	})
}
SocketState.prototype.rcv_userBroadcast = function(msg) {
	this.game.broadcast("userBroadcast", {
		from: this.id,
		data: msg.data,
	});
}
SocketState.prototype.rcv_userPM = function(msg) {
	this.game.pm(msg.to, "userPM", {
		from: this.id,
		to: msg.to,
		data: msg.data,
	});
}





var next_game_id = 1;
var next_message_ordinal = 1;
var next_connection_id = 1;
server.on('connection', function(socket){
	console.log('meh');
	
	new SocketState(socket);
// 	socket.on('message', idleListener(socket, next_connection_id++))
	
});