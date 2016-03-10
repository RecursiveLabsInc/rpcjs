"use strict";

var rpc = require("./rpcjs");
var actors = require("./actors");
var _ = require("lodash");
var EventEmitter = require("events").EventEmitter;
var assert = require("chai").assert;
var sinon = require("sinon");

var Promise = require("bluebird");

describe('rpc', function() {

  this.timeout(150);

  var server;
  var client;

  describe('simple RPC', function() {
    var clientEventSpy;

    beforeEach(function(done) {
      var self = this;
      createServerClientPair(self, done, function(start) {
        clientEventSpy = sinon.spy()
        server.on("clientEvent", clientEventSpy);

        server.expose({
          add: function(a, b) {
            return a + b;
          },
          neverFinish: function() {
            return new Promise(function() {
            })
          },
          start: function() {
            server.emit("something", { message: "hi" });
          },
          takes10Ms: function() {
            return new Promise(function(resolve) {
              setTimeout(resolve, 10); 
            })
          },
          reject: function() {
            return Promise.reject(new Error("rejected")); 
          },
          throws: function() {
            throw new Error("threw");
          },
        })

        start();

        done();
      });
    })

    it('is possible for client to call server', function(done) {
      client.call("add", 10, 5)
      .nodeify(function(err, result) {
        if(err) return done(err);

        assert.equal(result, 15);
        done();
      })
    })

    it('is possible for client to set call timeout', function(done) {
      client.call({ timeout: 0 }, "takes10Ms")
      .nodeify(expectTimeout(done))
    });

    it('is possible for client to register for events', function(done) {
      client.on("something", function(data) {
        assert.equal(data.message, "hi");
        done();
      });

      client.call("start");
    })

    it('is possible for server to hear events registered before client connected', function(done) {
      client.emit("clientEvent", "hi");

      setTimeout(function() {
        assert.equal(clientEventSpy.callCount, 1, "event should have fired once");
        done();
      }, 25);
    })

    it('acknowledges when events have been recevied', function() {
      return client.emit("hi")
    })

    it('will timeout method calls', function(done) {
      client.call("neverFinish")
      .nodeify(expectTimeout(done));
    })

    it('handles explicit rejections', function() {
      return client.call("reject")
      .catch(function(err) {
        assert.match(err.message, /rejected/);
      })
    })

    it('handles methods that throw errors', function() {
      return client
        .call("throws")
        .catch(function(err) {
          assert.match(err.message, /threw/);
        });
    })

    it('handles invalid messages incoming', function() {
       // expect a Error: invalid result 
    })

    it('handles methods not being defined explicitly', function() {
      return client.call("notDefined")
      .catch(function(err) {
        assert.match(err.message, /NoSuchMethod/); 
      });
    })
      
  })

  describe('connection ending', function() {

    beforeEach(function(done) {
      var self = this;
      createServerClientPair(self, done, function(start) {
        server.expose({
          add: function(a, b) {
            return a + b;
          },
          neverFinish: function() {
            return new Promise(function() {
            })
          },
        })

        start();
        done();
      })

    })

    it('provides an error if the server goes away', function(done) {
      client.setSend(_.noop);

      return client.call("add", 5, 10)
      .nodeify(expectTimeout(done))
    });

  })

  describe('actors', function() {

    beforeEach(function(done) {
      var self = this;

      self.remoteId = "incrementer-1";

      self.incrementer = _.defaults(new EventEmitter, {
        value: 0,
        name: "I am an ACTOR",
        increment: function() {
          return self.incrementer.value += 1; 
        },
        add: function(n, m) {
          return Promise.resolve(n + m); 
        },
        reject: function() {
          return Promise.reject(new Error("rejected")); 
        },
        throws: function() {
          throw new Error("threw");
        },
      });

      self.register = actors.register();

      createServerClientPair(self, done, function(start) {
        
        // expose actor registry
        self.register.expose(server);

        // expose an actor
        server.exposeActor(self.remoteId, self.incrementer);

        // give client ability to call remote actors
        actors.mixin(client);

        start();
        done();
      })
    })

    it('allows calling methods on the remote', function() {
      return client.callActor(this.remoteId, "increment")
      .then(function(now) {
        assert.equal(now, 1); 
      })
    })

    it('handles methods on actors that return promises', function() {
      return client.getActor(this.remoteId)
        .call("add", 5, 10)
        .then(function(result) {
          assert.equal(result, 15);
        })
    })

    it('can get properties', function() {
      return client.getActor(this.remoteId)
        .get("name")
        .then(function(result) {
          assert.match(result, /ACTOR/);
        })
    })

    it('handles promise rejections on actors', function() {
      return client.getActor(this.remoteId)
        .call("reject")
        .catch(function(err) {
          assert.match(err.message, /rejected/);
        })
    })

    it('handles methods that throw on actors', function() {
      return client.getActor(this.remoteId)
        .call("throws")
        .catch(function(err) {
          assert.match(err.message, /threw/);
        })
    })

    it('provides a convenient API to refer to an actor', function() {
      return client.getActor(this.remoteId)
        .call("increment")
        .then(function(now) {
          assert.equal(now, 1); 
        })
    })

    it('provides an error if actor has no such method', function() {
      return client.getActor(this.remoteId)
        .call("blah")
        .catch(function(err) {
          if(!/NoSuchMethod/.test(err.message)) {
            return Promise.reject(err);
          }
        })
    })

    it('supports listening to events on emitters', function() {
      return new Promise(function(resolve) {
        var incrementer = client.getActor(this.remoteId);

        incrementer.on("blah", function(data, b,c,d,e,f) {
          assert.equal(data.value, 15);
          assert.deepEqual([b,c,d,e,f], [2,3,4,5,6]);
          resolve();
        })

        this.incrementer.emit("blah", { value: 15 }, 2, 3, 4, 5, 6);
      }.bind(this));
    });

    it("emitters's events are scoped - they don't hear plain events", function() {
      return new Promise(function(resolve, reject) {
        var incrementer = client.getActor(this.remoteId);

        incrementer.on("emittedPlain", function() {
          reject(new Error("heard event on actor that was emitted plain")); 
        });

        server.on("emittedPlain", function() {
          // give a bit of time incase other event emitter fires
          setTimeout(function() {
            resolve();    
          }, 50);
        });

        client.emit("emittedPlain");
      }.bind(this));
    });

    it("emitters's events are scoped - they don't clash with plain events", function() {
      return new Promise(function(resolve, reject) {
        var incrementer = client.getActor(this.remoteId);

        incrementer.on("emittedActor", function() {
          // give a bit of time incase other event emitter fires
          setTimeout(function() {
            resolve();    
          }, 50);
        });

        server.on("emittedActor", function() {
          // give a bit of time incase other event emitter fires
          reject(new Error("heard event that should have been actor-scoped")); 
        });

        this.incrementer.emit("emittedActor");
      }.bind(this));
    });


    it('provides a error if the Actors has expired', function() {
      server.expireActor(this.remoteId);

      return client.callActor(this.remoteId, "increment")
      .catch(function(err) {
        if(!/Expired/.test(err.message)) {
          return Promise.reject(err);
        }
      })
    })

    it('prevents duplicate Actors', function() {
      assert.throws(function() {
        server.exposeActor(this.remoteId, this.incrementer)
      }.bind(this), /duplicate/i)
    })
      
  })

  describe('emit timeouts', function() {
    it('is possible to provide a different timeout for emit acks', function(done) {
      client.setSend(function(msg) {
        setTimeout(server.incoming, 100, msg); 
      });

      client.emit({ timeout: 50 }, "hi")
      .nodeify(expectTimeout(done))
    })

    it('simply providing a timeout does not affect the result', function() {
      return client.emit({ timeout: 125 }, "hi");
    });

  })




  function createServerClientPair(assign, errBack, ready) {
    server = rpc({
      name: "server",
      error: errBack,
      timeout: 75,
      Promise: Promise,
    });

    client = rpc.client({
      Promise: Promise,
      name: "client",
      error: errBack,
      timeout: 75,
    });

    server.setSend(client.incoming);
    client.setSend(server.incoming);

    ready(_.noop);
  }

  function expectTimeout(done) {
    return function(err) {
      if(err) {
        assert.match(err.message, /Timeout/);
        done();
      } else {
        done(new Error("expected timeout, got no error"));
      }
    }
  }

    
})
