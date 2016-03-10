/**
 * a set of convenience APIs for exposing and communicating with a scoped resource
 *
 */
"use strict";

var _ = require("lodash");
var helpers = require("./helpers");
var EventEmitter = require("events").EventEmitter;
var promiseHelpers = require("universal-promise-helpers");

var GET_PROPERTY = "-getActorProperty-";
var REGISTRATION_TIMEOUT = 500;

/**
 * exposes methods on a node to call actor API on the remote
 */
exports.mixin = function(node) {
  node.callActor = function(id, method) {
    var args = ["callActor", id, method].concat(_.slice(arguments, 2));
    return node.call.apply(null, args);
  };

  node.getActor = function getActor(id) {
    return new RemoteActor(id, node);
  };
};

exports.register = function() {
  return new ActorRegister;
}

/**
 * creates a registry of actors, that can be
 * exposed over a RPC node
 */
function ActorRegister() {
  var self = this;

  var actors = {};

  // when an actor is registered, fire events for any
  // calls waiting for it to appear
  var actorRegistrations = new EventEmitter;

  // we proxy through actor events to active nodes (if any)
  var actorEvents = new EventEmitter;

  var callTimeout = 500;

  var EXPIRED = {};

  /*
   * public API
   */
  self.expose = exposeActorApiOnNode;

  return;

  /*
   * private API
   */

  function exposeActor(id, actor) {
    if(typeof actor !== "object") {
      throw new Error("actor must be object");
    }
    if(actors[id]) {
      throw new Error("duplicate actor id: " + id);
    }
    actors[id] = actor;

    exposeActorEvents(actor);

    actorRegistrations.emit("register:" + id);

    function exposeActorEvents() {
      if(typeof actor.on !== "function") {
        return;
      }

      // use a flag instead of re-reassigning emit so
      // not to break if anyone else reassigns .emit!
      var proxy = true;

      // heavy-handed method, required because there is no
      // `onAll` or similar
      var wrappedEmit = actor.emit;
      actor.emit = function(name) {
        if(proxy) {
          actorEvents.emit("event", id, arguments);
        }
        wrappedEmit.apply(actor, arguments);
      };

      actorRegistrations.once("deregister:" + id, function() {
        proxy = false;
      });
    }
  }

  function call(PromiseConstructor, id, method) {
    var timeoutPromise = _.partial(promiseHelpers.timeout, PromiseConstructor);
    var params = _.slice(arguments, 3);

    // TODO have configurable 'wait for actor' and 'method timeout' durations
    return waitForActor(PromiseConstructor, id, REGISTRATION_TIMEOUT)
    .then(function runCall(actor) {
      var fn = actor[method];

      if(typeof fn !== "function") {
        var error = new Error("ActorNoSuchMethod");
        error.method = method;
        error.methods = _.methods(actor);
        return PromiseConstructor.reject(error);
      } else {
        return timeoutPromise(
          callTimeout
          , helpers.runEnsuringPromise(PromiseConstructor, fn.bind(actor), params)
          , "ActorCallTimeout"
        );
      }
    });
  }

  function getActorProperty(PromiseConstructor, id, property) {
    return waitForActor(PromiseConstructor, id, REGISTRATION_TIMEOUT)
    .then(function(actor) {
      return actor[property];
    });
  }

  function waitForActor(PromiseConstructor, id, n) {
    var timeoutPromise = _.partial(promiseHelpers.timeout, PromiseConstructor);

    var found = actors[id];
    if(found) {
      return Promise.resolve(notExpired(found));
    } else {
      return timeoutPromise(
        n
        , promiseHelpers.eventToPromise(PromiseConstructor, actorRegistrations, "register:" + id)
        , "ActorRegistrationTimeout"
      )
      .then(function() {
        return notExpired(actors[id]);
      });
    }

    function notExpired(found) {
      if(found === EXPIRED) {
        return PromiseConstructor.reject(new Error("ActorExpired"));
      } else {
        return found;
      }
    }
  }



  function exposeActorApiOnNode(node) {

    if(typeof node.exposeActor !== "undefined") {
      throw new Error("can't expose two registries on node");
    }

    // register the ability for remote to call methods on actors
    node.expose("callActor", _.partial(call, node._Promise));
    node.expose(GET_PROPERTY, _.partial(getActorProperty, node._Promise));

    // setup API
    node.getLocalActor = function(id) {
      return actors[id];
    };
    node.exposeActor = exposeActor;
    node.expireActor = expireActor;
    exports.mixin(node);

    // we take actor events, scope them to the actor, and fire them
    // on the node
    //
    actorEvents.on("event", fireEvents);

    return;

    function fireEvents(id, originalParams) {
      // we take the original params and rename the event according to actor
      // event naming rules
      var params = [actorEventName(id, originalParams[0])].concat(_.slice(originalParams, 1));
      node.emit.apply(null, params);
    }
  }

  function expireActor(id) {
    actors[id] = EXPIRED;
    actorRegistrations.emit("deregister:" + id);
  }

}

function RemoteActor(remoteId, node) {
  this.id = remoteId;

  this.call = _.partial(node.callActor, this.id);

  this.on = _.partial(proxiedEventMethod, "on");
  this.off = this.removeListener = _.partial(proxiedEventMethod, "removeListener");
  this.once = _.partial(proxiedEventMethod, "once");

  this.get = _.partial(node.call, GET_PROPERTY, this.id);

  function proxiedEventMethod(method, name, fn) {
    node[method](actorEventName(remoteId, name), fn);
  }
}

function actorEventName(id, eventName) {
  return "remote:" + id + ":" + eventName;
}



