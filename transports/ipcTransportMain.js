/**
 * provides a ipcConnector for main process
 */
"use strict";

var ipc = require('electron').ipcMain;
var common = require("./ipcTransportCommon");
var _ = require("lodash");

exports.connect = function(rpcPair, webContents) {
  rpcPair.setSend(function(msg) {
    send(msg);
  });

  ipc.on(common.TOPIC, incoming);

  return function disconnect() {
    send = _.noop;
    ipc.removeListener(common.TOPIC, incoming);
  };

  function incoming(event, msg) {
    if(event.sender === webContents) {
      rpcPair.incoming(msg);
    }
  }

  function send(msg) {
    webContents.send(common.TOPIC, msg);
  }

};
