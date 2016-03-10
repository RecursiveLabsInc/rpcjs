/**
 * provides a ipcConnector for renderer processes
 */
"use strict";

var ipc = window.require('ipc');
var common = require("./ipcTransportCommon");
var _ = require("lodash");

exports.connect = function(rpcPair) {
  rpcPair.setSend(function(msg) {
    send(msg);
  });

  ipc.on(common.TOPIC, rpcPair.incoming);

  return function disconnect() {
    send = _.noop;
    ipc.removeListener(common.TOPIC, rpcPair.incoming);
  };

  function send(msg) {
    ipc.send(common.TOPIC, msg);
  }
};
