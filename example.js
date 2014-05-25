var BattleNode = require('./lib');
var fs = require('fs');

var config = {
  ip: '127.0.0.1',
  port: 2302,
  rconPassword: 'testing'
};

var bnode = new BattleNode(config);

bnode.login();

bnode.on('login', function(err, success) {
  
  if (err) { console.log('Unable to connect to server.'); }

  if (success == true) {
    console.log('Logged in RCON successfully.');
  }
  else if (success == false) {
    console.log('RCON login failed! (password may be incorrect)');
  }
            
});

bnode.on('message', function(message) {
  
  console.log(message);
  
});

// send commands once connected
setTimeout(function() {

  bnode.sendCommand('version', function(version) {
    console.log('Battle Eye Version ' + version);
  });
  
  bnode.sendCommand('bans', function(bans) {
    
    fs.writeFile('bans.txt', bans, function (err) {
      if (err) console.log(err);
      
      console.log('Saved bans to bans.txt');
    });
                            
  });
  
  bnode.sendCommand('players', function(players) {
    console.log(players);
  });

}, 1000);

bnode.on('disconnected', function() {
  
  console.log('RCON server disconnected.');
  
});