/**
 * high-level RPC semantics offering call, events. RpcPairs can be client or server.
 *
 * A design goal is to let client code be as uncluttered by RPC stuff as possible (e.g calling a method without worrying about having to connect first), while giving control to handle timeouts etc that're vital with RPC.
 *
 * all methods return a promise. they will timeout if the
 * remote end never turns up
 *
 * ## `rpc(option: RpcOptions) => RpcPair`
 *
 *     interface RpcOptions {
 *       name: string
 *       Promise: PromiseConstructor
 *       timeout: number
 *       emitTimeout: number
 *       error: (err) => void
 *       wrapEffects: () => void
 *     }
 *
 *     interface RpcTransport {
 *       send: () => void
 *     }
 *
 * returns a new RpcPair
 *
 * ## methods of `RpcPair` instance
 *
 * ### `expose(name: string, (...args: Array<any>) => Promise<any> | any) => void`
 * ### `expose({[name: string]: (...args: Array<any>) => Promise<any> | any)}) => void`
 *
 * expose either a single or an object of methods to remote side.  methods can
 * be sync or async; always async for remote side
 *
 * ### `call(options: { timeout: number}, method, ...args: Array<any>) => Promise<any>`
 * ### `call(method : string, ...args: Array<any>) => Promise<any>`
 *
 * e.g
 *
 *     node.call("increment", 1).then(assertEqual(2));
 *     node.call({ timeout: 5000 }, "increment", 1).then(assertEqual(2));
 *
 * ### on(), once(), removeListener() (aliased to .off)
 *
 * listen to events emitted by remote side. arguments as per EventEmitter
 *
 * ### `emit(event : string, data : any) => Promise<any>`
 *
 * emit event heard by remote. returns promise resolved if remote side turned up to heard about it
 *
 * ## Actor API on `RpcPair`s
 *
 * ### `getActor(id: string) => RemoteActor`
 *
 * Returns an object used to interact with a remote actor.
 *
 * ### `exposeActor(id: string, a: LocalActor) => void`
 *
 * Exposes an actor which the remote side can interact with
 *
 * ### `callActor(id: string, method: string, ...params: Array<any>) => Promise<any>`
 *
 * call a method on an actor by id.
 *
 * ### `expireActor(id: string) => void`
 *
 * Expire a previously exposed actor.
 *
 *
 * Having a separate emitter differentiates from remote events.
 *
 * ## `interface LocalActor { on: (e: string, fn: (...args: any)) => void, expire: () => void )`
 *
 * Interface used by actor system. All optional. Methods called by remote side can be synchronous
 * or return a promise.
 *
 * ## RemoteActor API
 *
 * ### `.call()` - as `rpc.call()`
 * ### `.on(), .off()` etc - as `rpc.on() ...`
 * ### `.get(name: string) => any`
 *
 * Returns value of property on actor at point at which message is received. Serialized/deserialized as JSON.
 *
 * ## Notes
 *
 * this handles the idea of a connection with another process,
 * and should seamlessly do things like reconnect etc, only
 * bubbling up errors when nothing can be done.
 *
 *
 */
"use strict";

var EventEmitter = require("events").EventEmitter;
var _ = {
    defaults: require('lodash/defaults'),
    extend: require('lodash/extend'),
    partial: require('lodash/partial'),
    slice: require('lodash/slice')
};
var promiseHelpers = require("universal-promise-helpers");
var decorators = require("./decorators");
var helpers = require("./helpers");
var debug = require("debug");

// deliberately unique across processes, rather than pairs
var outgoingId = 0;

module.exports = exports = create;

// client and server are current functionally equivalent: both expose and call methods
exports.client = create;
exports.server = create;

function create(opts) {
  return new RpcPair(opts);
}

function RpcPair(opts) {
  var self = this;
  var send = function() {
    throw new Error("missing send function");
  };

  var log = opts.log || debug("rpcjs");

  // safety - take a copy
  opts = _.extend({
    // for libraries (e.g angular) that need to know when an async effect has occured
    wrapEffects: function(fn) {
      fn();
    },
  }, opts);

  if(!opts.name) {
    throw new Error("pair must have a name");
  }

  if(typeof opts.error !== "function") {
    throw new Error("must handle errors via opts.error");
  }

  self.name = opts.name;


  // prepare our helpers with promise constructor provided
  var PromiseConstructor = self._Promise = opts.Promise;

  var methods = {};

  var decoratorConfig = {
    isOptionsParameter: function(param) {
      return typeof param !== "string";
    },
  };

  // our listeners, waiting for incoming data
  var localListeners = new EventEmitter;

  function initialize() {
    opts = _.defaults(opts || {}, {
      timeout: 500,
      emitTimeout: 500,
    });
  }

  //
  // public API
  //
  self.expose = decorators.keyValueOrObject(function(name, fn) {
    log(self.name, "exposed", name);

    methods[name] = fn;
  });

  self.emit = decorators.optionsAsFirstParameter(emit, decoratorConfig);

  self.on = function() {
    localListeners.on.apply(localListeners, arguments);
  };

  self.once = function() {
    localListeners.once.apply(localListeners, arguments);
  };

  self.off =
  self.removeListener = function() {
    localListeners.removeListener.apply(localListeners, arguments);
  };

  // call, with overloaded args
  self.call = decorators.optionsAsFirstParameter(call, decoratorConfig);
  self.incoming = incoming;

  self.setSend = function(fn) {
    send = fn;
  };

  initialize();

  return;

  //
  // helpers and private API
  //

  /**
   * message coming in
   */
  function incoming(message) {
    log(self.name, "transport-received<" + message.id + ">", message);

    switch(message.type) {
    case "call":
      return callIncoming(message);
    case "notify":
      return notifyIncoming(message);
    case "result":
      log("receivedResult", message.id, message);
      return localListeners.emit(resultEvent(message), message);
    default:
      return error("unknown message type", message);
    }
  }

  function error(err) {
    opts.error(err);
  }

  function sendResult(id, result) {
    log("sendResult", id, result);

    write({
      id: id,
      type: "result",
      result: result || null,
    });
  }

  function sendError(id, error) {
    log("sendError", id, error);

    write({
      id: id,
      type: "result",
      // pull out all enumerable additions to error, plus standard fields
      error: _.extend({
        name: error.name,
        message: error.message,
        stack: error.stack,
      }, error),
    });
  }

  /**
   * other side calling one of the methods we've exposed (hopefully)
   */
  function callIncoming(message) {
    var method = message.method;
    var params = message.params;

    log(self.name, "incomingCall", method, params);

    var fn = methods[method];
    if(fn) {
      helpers.runEnsuringPromise(PromiseConstructor, fn, params)
        .then(_.partial(sendResult, message.id), _.partial(sendError, message.id));
    } else {
      var error = new Error("NoSuchMethod");
      error.method = method;
      error.params = params;
      sendError(message.id, error);
    }
  }

  function acknowledgedWrite(message, timeout) {
    var result = promiseHelpers.eventToPromise(PromiseConstructor, localListeners, resultEvent(message));

    // handle synchronous write errors - like socket closed
    try {
      send(message);
    } catch(e) {
      return PromiseConstructor.reject(e);
    }

    return promiseHelpers.timeout(PromiseConstructor, timeout, result,
        "TimeoutWaitingForWriteAck<" + message.id + "," + message.type + ",duration: " + timeout + ">");
  }

  function write(message) {
    log(self.name, "transport-written<" + message.id + ">", message);

    // handle synchronous write errors - like socket closed
    try {
      send(message);
    } catch(e) {
      error(e);
    }
  }

  /**
   * other side wants to notify us of events
   */
  function notifyIncoming(message) {
    log(self.name, "notifyIncoming", message.event, message.data);

    sendResult(message.id);

    opts.wrapEffects(function() {
      localListeners.emit.apply(localListeners, [message.event].concat(message.data));
    });
  }

  /**
   * calls a method of the remote side, returning a promise
   */
  function call(options, method) {
    var callOptions = _.defaults(options, { timeout: opts.timeout });
    var params = _.slice(arguments, 2);

    var id = createNextOutgoingId();
    log('request', id, "method: " + method);

    return acknowledgedWrite({
      id: id,
      type: "call",
      method: method,
      params: params,
    }, callOptions.timeout)
    .then(handleResult);

    function handleResult(result) {
      if("result" in result) {
        return result.result;
      } else if ("error" in result) {
        return PromiseConstructor.reject(ensureError(result.error));
      } else {
        log("invalid result", result);

        var error = new Error("invalid result");
        error.result = result;
        return PromiseConstructor.reject(error);
      }
    }
  }

  /**
   * emits on remote side
   */
  function emit(options, evt) {
    var callOptions = _.defaults(options, { acknowledge: true, timeout: opts.emitTimeout });
    var data = _.slice(arguments, 2);

    return acknowledgedWrite({
      id: createNextOutgoingId(),
      type: "notify",
      event: evt,
      data: data,
    }, callOptions.timeout);
  }

  function createNextOutgoingId() {
    outgoingId += 1;
    return self.name + ":" + outgoingId;
  }
}

function ensureError(err) {
  if(err instanceof Error) {
    err.remote = true;
    return err;
  } else {
    var properties = _.defaults(err || {}, { message: "RejectedWithNonError" });
    var error = new Error(properties.message);
    error.remote = true;
    _.extend(error, properties);
    return error;
  }
}

function resultEvent(message) {
  return "result:" + message.id;
}
