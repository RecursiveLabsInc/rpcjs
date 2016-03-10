"use strict";

var _ = require("lodash");

exports.start = function(pair, stream) {

  pair.setSend(_.partial(exports.send, stream));

  return exports.incoming(pair, stream);
};

exports.send = function(stream, msg) {
  stream.write(JSON.stringify(msg) + "\n");
};

exports.incoming = function(pair, stream) {
  var buf = "";
  stream.on("data", function(data) {
    buf += data;
    var lines = buf.split("\n");

    // start buffer again with whatever comes after last newline
    buf = lines.pop();

    lines.forEach(function(line) {
      try {
        var parsed = JSON.parse(line);
      } catch(e) {
        var err = new Error("RpcStreamTransportJsonParseError");
        err.line = line;
        err.original = e;
        stream.emit("error", err);
      }

      pair.incoming(parsed);
    });
  });

  return function disconnect() {
    stream.removeListener("data", pair.incoming);
  };
};
