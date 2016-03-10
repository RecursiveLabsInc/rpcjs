# RPCjs

[![Build Status](https://travis-ci.org/sidekickcode/rpcjs.svg?branch=master)](https://travis-ci.org/sidekickcode/rpcjs)

The easiest RPC you've seen, entirely promise based, that plays well with:

- all environments: Node, Browser, Electron etc
- all transports: TPC, sockets, whatever you fancy?
- all Promise-A implemenations: Bluebird, Q, ES6, jQuery etc
- all node versions: 0.10 +, es6 or not

RPC nodes are the core of the API. The transport is defined by you, so you can do whatever you like. There are built-in transports.

A design goal is to let client code be as uncluttered by RPC stuff as possible (e.g calling a method without worrying about having to connect first), while giving control to handle timeouts etc that're vital with RPC.

All methods return a promise. they will timeout if the remote end never turns up. Documentation below uses TypeScript as it's a nicely defined way of talking about types!

## `rpcjs.rpc(option: RpcOptions) => RpcPair`

    interface RpcOptions {
      name: string
      Promise: PromiseConstructor
      timeout: number
      emitTimeout: number
      error: (err) => void
      wrapEffects: () => void
    }

    interface RpcTransport {
      send: () => void
    }

returns a new RpcPair

## methods of `RpcPair` instance

### `expose(name: string, (...args: Array<any>) => Promise<any> | any) => void`
### `expose({[name: string]: (...args: Array<any>) => Promise<any> | any)}) => void`

expose either a single or an object of methods to remote side.  methods can
be sync or async; always async for remote side

    node.expose("answer", function(number) {
      return number + 42;
    });

### `call(options: { timeout: number}, method, ...args: Array<any>) => Promise<any>`
### `call(method : string, ...args: Array<any>) => Promise<any>`

Takes call options as optional first argument (useful for `.bind`/`_.partial` to create
an API with default timeouts etc):

e.g

    node.call("increment", 1).then(assertEqual(2));
    node.call({ timeout: 5000 }, "increment", 1).then(assertEqual(2));

### on(), once(), removeListener() (aliased to .off)

listen to events emitted by remote side. arguments as per EventEmitter

### `emit(event : string, data : any) => Promise<any>`

emit event heard by remote. returns promise resolved if remote side turned up to heard about it

## Actor API on `RpcPair`s

RPCjs also supports the ideas of Actors. You'll frequently be wanting to talk about a given context - actors give you a way to to this without continually resending the same context ID.

### `getActor(id: string) => RemoteActor`

Returns an object used to interact with a remote actor.

### `exposeActor(id: string, a: LocalActor) => void`

Exposes an actor which the remote side can interact with

### `callActor(id: string, method: string, ...params: Array<any>) => Promise<any>`

call a method on an actor by id.

### `expireActor(id: string) => void`

Expire a previously exposed actor.


Having a separate emitter differentiates from remote events.

## `interface LocalActor { on: (e: string, fn: (...args: any)) => void, expire: () => void )`

Interface used by actor system. All optional. Methods called by remote side can be synchronous
or return a promise.

## RemoteActor API

### `.call()` - as `rpc.call()`
### `.on(), .off()` etc - as `rpc.on() ...`
### `.get(name: string) => any`

Returns value of property on actor at point at which message is received. Serialized/deserialized as JSON.


## Transports

Transports are very simple. They call a RpcPair's `.incoming` method with incoming messages, and use `.setSend` to inform a pair that it can send messages via this transport.

That's it! Take a look at `transports/streamTransport.js` to see a transport that lets RPCjs work with TCP/UDP/HTTPS or whatever streams you like, however crazy the chain of compression, encryption etc in that stream is!

## Debug

To see debug messages, set the DEBUG env var:

```sh
DEBUG=rpcjs node yourApp.js
```
