var crc32 = require('buffer-crc32');
var dgram = require('dgram');
var events = require('events');
var util = require('util');

module.exports = BattleNode;

const BE_LOGIN_PACKET = 0;
const BE_COMMAND_PACKET = 1;
const BE_SERVER_MSG_PACKET = 2;

function BattleNode(config) {
  
  var self = this;
  
  this.config = config;
  this.connected = false;
  this.sequence = 0;
  this.callbacks = [];
  this.multipartPacket = [];
  this.lastKeepaliveSequence = 0;
  this.receivedLoginResponse = false;
  
  this.socket = dgram.createSocket('udp4');
  
  this.socket.on('message', function(msg, rinfo) {
    self.emit('packet', msg, rinfo);
  });
  
  this.on('packet', this.packet);
  
  // setup keepalive packet on timer
  this.keepalive = setInterval(function() {

    // server didn't respond to last keepalive (disconnected)
    if (self.lastKeepaliveSequence) {
      
      clearInterval(self.keepalive);
      self.emit('disconnected');

    }
    
    var packet = self.keepalivePacket();

    self.socket.send(packet, 0, packet.length, self.config.port, self.config.ip);
    
  }, 10000);
  
};

util.inherits(BattleNode, events.EventEmitter);

BattleNode.prototype.login = function() {
  
  var self = this;
  var packet = this.loginPacket(self.config.rconPassword);
  
  this.socket.send(packet, 0, packet.length, self.config.port, self.config.ip);
  
  // wait 5 seconds for server response
  setTimeout(function() {
    
    if (!self.receivedLoginResponse) {
      
      self.emit('login', true);
      clearInterval(self.keepalive);
      
    }
    
  }, 5000);
  
};

BattleNode.prototype.packet = function(msg, rinfo) {
  
  var self = this;
  
  if (msg.length < 7) return;
  
  // check for battle eye packet header
  if (msg.toString('utf8', 0, 2) == 'BE') {
    
    var payload = msg.slice(6, msg.length);
    var packetCrc = msg.readInt32BE(2);
    var crc = crc32(payload).readInt32LE(0);
    
    // check crc32 matches
    if (crc == packetCrc) {
    
      switch (payload.readUInt8(1)) {
          
          case BE_LOGIN_PACKET:
          
            var loggedIn = payload.readUInt8(2);

            this.receivedLoginResponse = true;
          
            if (loggedIn == true) {
              this.emit('login', null, true);
            }
            else {
              this.emit('login', null, false);
            }
          
          break;
          
          case BE_COMMAND_PACKET:
          
            var sequence = payload.readUInt8(2);
            var message = payload.slice(3, payload.length).toString();
          
            // keepalive response
            if (payload.length == 3) {
              
              if (payload.readUInt8(1) == 1 && payload.readUInt8(2) == self.lastKeepaliveSequence) {
                
                self.lastKeepaliveSequence = 0;
                
              }
              
            }
          
            // multipart packet
            if (payload.length > 4 && payload.readUInt8(3) == 0) {
              
              var totalPackets = payload.readUInt8(4);
              var packetIndex = payload.readUInt8(5);
              var partPacket = payload.slice(6, payload.length);
              
              if (self.multipartPacket[sequence] == null) {
                
                self.multipartPacket[sequence] = partPacket;
                
              }
              else {
                
                self.multipartPacket[sequence] = Buffer.concat([ self.multipartPacket[sequence], partPacket ],  self.multipartPacket[sequence].length + partPacket.length );
                
              }
              
              // got all packets
              if ((packetIndex + 1) == totalPackets) {
                
                if (typeof(self.callbacks[sequence]) == 'function') {

                  var callback = self.callbacks[sequence];

                  callback(self.multipartPacket[sequence].toString());

                  delete self.callbacks[sequence];
                  delete self.multipartPacket[sequence];

                }
                
              };
              
            } else {
              
              if (typeof(self.callbacks[sequence]) == 'function') {

                var callback = self.callbacks[sequence];

                callback(message);

                delete self.callbacks[sequence];

              }
              
            }
          
          
          break;
          
          case BE_SERVER_MSG_PACKET:
          
            var sequence = payload.readUInt8(2);
            var packet = self.ackPacket(sequence);
            var message = payload.slice(3, payload.length).toString();

            self.socket.send(packet, 0, packet.length, self.config.port, self.config.ip);

            this.emit('message', message);

          break;
      }
        
    }
    
  }
  
};

BattleNode.prototype.createBEPacket = function(payload) {

  var packet = new Buffer(payload.length + 6); // payload + header
  var header = new Buffer([0x42, 0x45, 0x00, 0x00, 0x00, 0x00]);
  var crc = crc32(payload);
  
  header.writeInt32BE(crc.readInt32LE(0), 2);
  
  header.copy(packet);
  payload.copy(packet, 6);
  
  return packet;
  
}

BattleNode.prototype.loginPacket = function(password) {
  
  var data = new Buffer(password.length + 2);
  
  data.writeUInt8(0xFF, 0);
  data.writeUInt8(BE_LOGIN_PACKET, 1);
  
  data.write(password, 2);
  
  var packet = this.createBEPacket(data);
  
  return packet;
  
}

BattleNode.prototype.keepalivePacket = function() {
  
  var data = new Buffer(3);
  
  data.writeUInt8(0xFF, 0);
  data.writeUInt8(BE_COMMAND_PACKET, 1);
  data.writeUInt8(this.sequence, 2);
  
  this.lastKeepaliveSequence = this.sequence;
  
  this.sequence = (this.sequence >= 255) ? 0 : this.sequence + 1;
  
  var packet = this.createBEPacket(data);
  
  return packet;
  
}

BattleNode.prototype.ackPacket = function(sequence) {
  
  var data = new Buffer(3);
  
  data.writeUInt8(0xFF, 0);
  data.writeUInt8(BE_SERVER_MSG_PACKET, 1);
  data.writeUInt8(sequence, 2);
  
  var packet = this.createBEPacket(data);
  
  return packet;
}

BattleNode.prototype.commandPacket = function (command) {
  
  var data = new Buffer(command.length + 3);
  
  data.writeUInt8(0xFF, 0);
  data.writeUInt8(BE_COMMAND_PACKET, 1);
  data.writeUInt8(this.sequence, 2);
  data.write(command, 3);
  
  this.sequence = (this.sequence >= 255) ? 0 : this.sequence + 1;
  
  var packet = this.createBEPacket(data);
  
  return packet;
  
}


BattleNode.prototype.sendCommand = function (command, callback) {

  var self = this;
  var packet = this.commandPacket(command);
  
  this.socket.send(packet, 0, packet.length, self.config.port, self.config.ip);
  
  if (callback != null) {
    
    self.callbacks[this.sequence - 1] = callback;
    
  }
  
}
